/**
 * Request bodies (spec §7.3, as amended by decisions D2–D4), validated with Zod on the API
 * and reused by the web app. Binary blobs travel as unpadded base64url strings.
 */
import { z } from "zod";

export const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected 32-byte hex");
export const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected 0x address");
export const qorAddress = z.string().regex(/^qor1[02-9ac-hj-np-z]{38}$/, "expected qor1 address");
export const b64url = z.string().regex(/^[A-Za-z0-9_-]*$/, "expected base64url");
/** ML-DSA-87 signature (4,627 bytes) as 0x hex. */
export const mldsaSignature = z.string().regex(/^0x[0-9a-fA-F]{9254}$/, "expected a 4,627-byte ML-DSA-87 signature");

// ── auth (D2: SIWQ signed by the role key) ──
export const SiwqChallengeBody = z.object({ address: qorAddress });
export const SiwqSignature = z.object({
  signatureType: z.enum(["ml-dsa-87-hybrid", "secp256k1"]),
  classical: z.object({ keyType: z.enum(["secp256k1", "eth_secp256k1"]), publicKey: z.string(), signature: z.string() }),
  pq: z.object({ algorithmId: z.number(), signature: z.string() }).optional(),
});
export const SiwqVerifyBody = z.object({ message: z.string().min(1).max(4096), signature: SiwqSignature });
export const RoleCardBody = z.object({ sealCard: z.record(z.string(), z.unknown()) });

// ── exams & centres ──
export const CreateExamBody = z.object({
  title: z.string().min(1).max(200),
  salt: hex32,
  startTime: z.number().int().positive(), // unix seconds
  examiners: z.tuple([evmAddress, evmAddress, evmAddress]),
  masterCommitment: hex32,
  committeeBlob: b64url.min(1),
  signature: mldsaSignature, // board's signature over the CreateExam digest
});
export const SetCentreBody = z.object({
  name: z.string().min(1).max(120),
  centreId: hex32,
  commitment: hex32,
  cipherBlob: b64url.min(1),
  shares: z.tuple([b64url.min(1), b64url.min(1), b64url.min(1)]),
  signature: mldsaSignature,
});

export type CreateExamBody = z.infer<typeof CreateExamBody>;
export type SetCentreBody = z.infer<typeof SetCentreBody>;
export type SiwqVerifyBody = z.infer<typeof SiwqVerifyBody>;
