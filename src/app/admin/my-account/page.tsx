"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function MyAccountPage() {
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [nameMessage, setNameMessage] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      setEmail(user.email ?? "");

      const { data: profile } = await supabase
        .from("users")
        .select("full_name")
        .eq("id", user.id)
        .single();
      if (profile) setFullName(profile.full_name);
    })();
  }, []);

  async function handleUpdateName(e: React.FormEvent) {
    e.preventDefault();
    setSavingName(true);
    setNameMessage(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSavingName(false);
      return;
    }

    const { error } = await supabase
      .from("users")
      .update({ full_name: fullName })
      .eq("id", user.id);

    setNameMessage(error ? error.message : "Name updated.");
    setSavingName(false);
  }

  async function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordMessage(null);

    if (newPassword.length < 6) {
      setPasswordMessage("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage("Passwords don't match.");
      return;
    }

    setSavingPassword(true);
    // A user can always update their own auth record directly — no
    // service-role/API route needed for this, unlike resetting someone
    // else's password.
    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      setPasswordMessage(error.message);
    } else {
      setPasswordMessage("Password updated.");
      setNewPassword("");
      setConfirmPassword("");
    }
    setSavingPassword(false);
  }

  return (
    <div className="min-h-screen bg-white/80 p-6 backdrop-blur-sm">
      <div className="mx-auto max-w-md">
        <h1 className="mb-6 text-2xl font-bold text-slate-900">My account</h1>

        <section className="mb-6 rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-slate-800">Profile</h2>
          <form onSubmit={handleUpdateName} className="space-y-4">
            {nameMessage && (
              <p className="rounded-lg bg-indigo-50 p-3 text-sm text-indigo-700">
                {nameMessage}
              </p>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
              <input
                value={email}
                disabled
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
              />
              <p className="mt-1 text-xs text-slate-400">
                Email can't be changed here — contact another admin if needed.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Full name</label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={savingName}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {savingName ? "Saving…" : "Save name"}
            </button>
          </form>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-slate-800">Change password</h2>
          <form onSubmit={handleUpdatePassword} className="space-y-4">
            {passwordMessage && (
              <p className="rounded-lg bg-indigo-50 p-3 text-sm text-indigo-700">
                {passwordMessage}
              </p>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Confirm new password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={savingPassword}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {savingPassword ? "Saving…" : "Update password"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
