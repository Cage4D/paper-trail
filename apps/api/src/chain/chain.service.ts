/**
 * QoreChain access for the API: viem on the EVM lane (chain 9800) and the native lane for the
 * relayer's EVM authorisation window.
 *
 * QoreChain specifics:
 *  - pqcKeyStatus (0x…0a02) / pqcVerify (0x…0a01) precompiles, read with eth_call (findings Q1/Q3).
 *  - Every relayer EVM tx needs a live EVM window, opened by a hybrid-signed (secp256k1 +
 *    ML-DSA-87) MsgOpenEVMWindow on the native lane. Ours is narrowed with allowedTargets =
 *    [PaperTrail] (findings Q5). Opening advances the account nonce, so it is only done under
 *    the relayer lock (RelayerService).
 */
import { Injectable } from '@nestjs/common';
import { StargateClient } from '@cosmjs/stargate';
import {
  createPublicClient, createWalletClient, getAddress, http, type Abi, type Account, type Chain, type Hex, type PublicClient, type Transport, type WalletClient,
} from 'viem';
import { IQORE_PQC_ABI, PRECOMPILE_ADDRESSES, evmAccountFromPrivateKey, evmWindowStatus, qorechainTestnet } from '@qorechain/evm';
import { EthNativeSigner, deriveUnifiedAccount, getNetwork, openEvmWindowMsg, type UnifiedAccount } from '@qorechain/sdk';
import { PAPERTRAIL_ABI } from '@paper-trail/shared';
import { config } from '../config.js';

// @qorechain/evm types its chain against an older viem Chain; the object is a valid viem chain.
const CHAIN = qorechainTestnet as unknown as Chain;
const NATIVE_FEE = { amount: [{ denom: 'uqor', amount: '100000' }], gas: '800000' };

export const WINDOW = { blocks: 17280n, maxTxs: 50n, maxValueUqor: 5_000_000n } as const;
/** Reopen when the window is nearly used up (spec §7.1). */
export const REOPEN = { minTxs: 3n, minBlocks: 100n, minValueUqor: 500_000n } as const;

@Injectable()
export class ChainService {
  readonly address: Hex = getAddress(config().PAPERTRAIL_ADDRESS);
  readonly abi = PAPERTRAIL_ABI as unknown as Abi;
  readonly client: PublicClient = createPublicClient({ chain: CHAIN, transport: http(config().EVM_RPC, { retryCount: 2, timeout: 20_000 }) });
  readonly rest = config().QORE_REST;
  readonly rpc = config().QORE_RPC || getNetwork('testnet').endpoints.rpc;
  readonly nativeChainId = getNetwork('testnet').chainId;
  private relayerAcct?: Promise<UnifiedAccount>;

  relayer(): Promise<UnifiedAccount> {
    this.relayerAcct ??= deriveUnifiedAccount(config().RELAYER_MNEMONIC, 0);
    return this.relayerAcct;
  }

  async wallet(): Promise<WalletClient<Transport, Chain, Account>> {
    const r = await this.relayer();
    return createWalletClient({ chain: CHAIN, transport: http(config().EVM_RPC), account: evmAccountFromPrivateKey(r.privateKey as Hex) });
  }

  async nonceOf(signer: Hex): Promise<bigint> {
    return (await this.client.readContract({ address: this.address, abi: this.abi, functionName: 'nonces', args: [signer] })) as bigint;
  }

  async pqcKeyStatus(account: Hex): Promise<{ registered: boolean; algorithmId: number; pubkey: Hex }> {
    const [registered, algorithmId, pubkey] = (await this.client.readContract({
      address: getAddress(PRECOMPILE_ADDRESSES.pqcKeyStatus), abi: IQORE_PQC_ABI, functionName: 'pqcKeyStatus', args: [account],
    })) as readonly [boolean, number, Hex];
    return { registered, algorithmId, pubkey };
  }

  /** The real precompile, via eth_call: the same check the contract will make. */
  async pqcVerify(pubkey: Hex, signature: Hex, message: Hex): Promise<boolean> {
    return (await this.client.readContract({
      address: getAddress(PRECOMPILE_ADDRESSES.pqcVerify), abi: IQORE_PQC_ABI, functionName: 'pqcVerify', args: [pubkey, signature, message],
    })) as boolean;
  }

  async windowStatus() {
    const r = await this.relayer();
    return evmWindowStatus({ rest: this.rest, address: r.cosmos });
  }

  /** Needs a reopen? (no window, not live, narrowed elsewhere, or nearly used up) */
  async windowNeedsReopen(): Promise<boolean> {
    const w = await this.windowStatus();
    if (!w.found || !w.live) return true;
    const targets = (w.allowedTargets ?? []).map((t) => t.toLowerCase());
    if (targets.length !== 1 || targets[0] !== this.address.toLowerCase()) return true;
    return w.remainingTxs < REOPEN.minTxs || w.remainingBlocks < REOPEN.minBlocks || w.remainingValue < REOPEN.minValueUqor;
  }

  /** Open (replace) the relayer's window, narrowed to PaperTrail. Call only under the relayer lock. */
  async openWindow(): Promise<string> {
    const r = await this.relayer();
    const msg = openEvmWindowMsg({ sender: r.cosmos, blocks: WINDOW.blocks, maxTxs: WINDOW.maxTxs, maxValue: WINDOW.maxValueUqor, allowedTargets: [this.address] });
    const acc = (await (await fetch(`${this.rest}/cosmos/auth/v1beta1/accounts/${r.cosmos}`)).json()) as { account: Record<string, unknown> };
    const base = (acc.account.base_account ?? acc.account) as Record<string, string>;
    const signer = new EthNativeSigner(r, { signMode: 'hybrid', rest: this.rest });
    const transport = await StargateClient.connect(this.rpc);
    try {
      const res = await signer.signAndBroadcast(transport, {
        chainId: this.nativeChainId, accountNumber: BigInt(base.account_number), sequence: BigInt(base.sequence), fee: NATIVE_FEE, messages: [msg],
      });
      if (res.code !== 0) throw new Error(`window open failed (code ${res.code})`);
      return res.transactionHash;
    } finally {
      transport.disconnect();
    }
  }

  async relayerBalanceWei(): Promise<bigint> {
    const r = await this.relayer();
    return this.client.getBalance({ address: r.evm as Hex });
  }
}
