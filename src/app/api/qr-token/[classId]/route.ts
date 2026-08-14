// GET /api/qr-token/[classId]
//
// Returns the current rotating token for a class session, plus how
// many ms until it rotates. Only the teacher who owns the class (or
// an admin) may request it — this is what gets encoded into the QR
// code rendered on the teacher's screen.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentToken } from "@/lib/utils/qr-token";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ classId: string }> }
) {
  const { classId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: klass, error } = await supabase
    .from("classes")
    .select("id, teacher_id, qr_secret, status")
    .eq("id", classId)
    .single();

  if (error || !klass) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  const isOwner = klass.teacher_id === user.id;
  const isAdmin = profile?.role === "admin";
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (klass.status !== "active") {
    return NextResponse.json(
      { error: "Class session is not active" },
      { status: 409 }
    );
  }

  const { token, expiresInMs } = currentToken(klass.id, klass.qr_secret);

  // The QR payload embeds classId + token so the scanner doesn't need
  // any prior context beyond what's in the code itself.
  const qrPayload = JSON.stringify({ classId: klass.id, token });

  return NextResponse.json({ qrPayload, token, expiresInMs });
}
