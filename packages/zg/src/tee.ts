// Our own check of a decision's TEE signature (HANDOFF §6.4): EIP-191 recovery must equal the provider's
// acknowledged on-chain teeSignerAddress. Never additionalInfo.TargetTeeAddress (SDK issue #100).
import { Contract, JsonRpcProvider, verifyMessage } from "ethers";
import { MAINNET, SIG_PREFIX } from "./constants.js";

const SERVING_ABI = [
  "function getService(address provider) view returns (tuple(address provider, string serviceType, string url, uint256 inputPrice, uint256 outputPrice, uint256 updatedAt, string model, string verifiability, string additionalInfo, address teeSignerAddress, bool teeSignerAcknowledged))",
];

export interface TeeService {
  signerOnchain: string;
  acknowledged: boolean;
  verifiability: string;
  targetSeparated: boolean | null;
}

export async function readTeeService(provider: string = MAINNET.provider, rpc: string = MAINNET.rpc): Promise<TeeService> {
  const serving = new Contract(MAINNET.inferenceServing, SERVING_ABI, new JsonRpcProvider(rpc, MAINNET.chainId, { staticNetwork: true }));
  const s = await serving.getFunction("getService")(provider);
  const info = JSON.parse(s.additionalInfo || "{}");
  return { signerOnchain: s.teeSignerAddress, acknowledged: s.teeSignerAcknowledged, verifiability: s.verifiability,
           targetSeparated: typeof info.TargetSeparated === "boolean" ? info.TargetSeparated : null };
}

export function verifyTeeSignature(text: string, signature: string, service: TeeService): { verified: boolean; signer: string | null; reason?: string } {
  if (!(service.acknowledged && service.verifiability === "TeeML" && service.targetSeparated === false)) {
    return { verified: false, signer: null, reason: "service is not an acknowledged, non-separated TeeML signer" };
  }
  if (!text.startsWith(SIG_PREFIX)) return { verified: false, signer: null, reason: "not a zg-sig-v1 sealed-exchange signature" };
  let signer: string;
  try {
    signer = verifyMessage(text, signature);
  } catch {
    return { verified: false, signer: null, reason: "signature does not recover" };
  }
  const verified = signer.toLowerCase() === service.signerOnchain.toLowerCase();
  return verified ? { verified, signer } : { verified, signer, reason: "recovered signer is not the on-chain TEE signer" };
}
// 2026-11-06T08:50:00
