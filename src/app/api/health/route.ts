import { NextResponse } from "next/server";

import { getHealthStatus } from "@/lib/health";

export async function GET() {
  return NextResponse.json(getHealthStatus());
}
