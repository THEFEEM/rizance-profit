import { NextRequest, NextResponse } from "next/server";
import { scanSlip } from "@/lib/ai-slip";
import { getCurrentUser } from "@/lib/session";

type ScanSlipBody = {
  imageBase64?: unknown;
  mediaType?: unknown;
  kind?: unknown;
  slipType?: unknown;
};

function isSupportedMediaType(value: unknown): value is "image/jpeg" | "image/png" {
  return value === "image/jpeg" || value === "image/png";
}

function isSupportedKind(value: unknown): value is "income" | "expense" {
  return value === "income" || value === "expense";
}

function isSupportedSlipType(value: unknown): value is "transfer" | "receipt" {
  return value === "transfer" || value === "receipt";
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: ScanSlipBody;
  try {
    body = (await req.json()) as ScanSlipBody;
  } catch {
    return NextResponse.json({ error: "invalid input" }, { status: 400 });
  }

  const { imageBase64, mediaType, kind, slipType } = body;
  if (
    typeof imageBase64 !== "string" ||
    imageBase64.trim() === "" ||
    !isSupportedKind(kind)
  ) {
    return NextResponse.json({ error: "invalid input" }, { status: 400 });
  }

  if (mediaType != null && !isSupportedMediaType(mediaType)) {
    return NextResponse.json({ error: "invalid input" }, { status: 400 });
  }

  if (slipType != null && !isSupportedSlipType(slipType)) {
    return NextResponse.json({ error: "invalid input" }, { status: 400 });
  }

  try {
    const result = await scanSlip(
      imageBase64,
      isSupportedMediaType(mediaType) ? mediaType : "image/jpeg",
      kind,
      isSupportedSlipType(slipType) ? slipType : "transfer",
    );
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("scan-slip error:", err);
    return NextResponse.json({ error: "scan failed" }, { status: 500 });
  }
}
