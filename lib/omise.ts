import Omise from "omise";

const OMISE_VERSION = "2019-05-29";

function requireOmiseKeys(): { publicKey: string; secretKey: string } {
  const publicKey = process.env.OMISE_PUBLIC_KEY;
  const secretKey = process.env.OMISE_SECRET_KEY;
  if (!publicKey || !secretKey) {
    throw new Error("Omise keys are not configured (OMISE_PUBLIC_KEY / OMISE_SECRET_KEY)");
  }
  return { publicKey, secretKey };
}

let client: ReturnType<typeof Omise> | null = null;

/** Lazily initialized Omise client — keys read from env at runtime only. */
export function getOmise(): ReturnType<typeof Omise> {
  if (!client) {
    const { publicKey, secretKey } = requireOmiseKeys();
    client = Omise({ publicKey, secretKey, omiseVersion: OMISE_VERSION });
  }
  return client;
}
