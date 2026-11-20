// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice Test double of QoreChain's `pqcKeyStatus` precompile (0x…0a02).
/// Installed with `vm.etch`; its storage then lives at the precompile address.
contract MockPqcKeyStatus {
    struct Key {
        bool registered;
        uint8 algorithmId;
        bytes pubkey;
    }

    mapping(address => Key) internal keys;

    function setKey(address account, bool registered, uint8 algorithmId, bytes calldata pubkey) external {
        keys[account] = Key(registered, algorithmId, pubkey);
    }

    function pqcKeyStatus(address account) external view returns (bool, uint8, bytes memory) {
        Key storage k = keys[account];
        return (k.registered, k.algorithmId, k.pubkey);
    }
}

/// @notice Test double of QoreChain's `pqcVerify` precompile (0x…0a01).
///
/// It keeps the properties of the real one that the contract relies on, as measured
/// on diana (findings Q1/Q3): exact ML-DSA-87 sizes (2,592-byte key, 4,627-byte
/// signature), verification of the message bytes AS GIVEN, and `false`, not a
/// revert, for anything invalid.
/// Signing is simulated with a test key table: each test key has a secret, and a
/// valid "signature" is keccak256(secret ‖ message) followed by zero padding to 4,627
/// bytes. Real ML-DSA-87 is exercised against the real precompile in Phase 2.
contract MockPqcVerify {
    uint256 internal constant PK_LEN = 2592;
    uint256 internal constant SIG_LEN = 4627;

    mapping(bytes32 => bytes32) internal secretOf; // keccak256(pubkey) => secret

    function setSecret(bytes calldata pubkey, bytes32 secret) external {
        secretOf[keccak256(pubkey)] = secret;
    }

    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        view
        returns (bool)
    {
        if (pubkey.length != PK_LEN || signature.length != SIG_LEN) return false;
        bytes32 secret = secretOf[keccak256(pubkey)];
        if (secret == bytes32(0)) return false;
        return bytes32(signature[0:32]) == keccak256(abi.encodePacked(secret, message));
    }
}
