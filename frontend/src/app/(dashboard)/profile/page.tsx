"use client";

import { useState, useEffect } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { apiGet, apiPut, apiPost } from "@/services/api";
import { User, Lock, Save, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

interface ProfileData {
  id: string;
  email: string;
  name: string | null;
  role: string;
  avatarUrl: string | null;
  bio: string | null;
  organization: string | null;
  lastLoginAt: string | null;
  createdAt: string | null;
}

export default function ProfilePage() {
  const { user, hydrateProfile } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [organization, setOrganization] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    async function fetchProfile() {
      try {
        const data = await apiGet<ProfileData>("/api/v1/auth/me");
        setProfile(data);
        setName(data.name || "");
        setBio(data.bio || "");
        setOrganization(data.organization || "");
        setAvatarUrl(data.avatarUrl || "");
        hydrateProfile({
          avatarUrl: data.avatarUrl,
          bio: data.bio,
          organization: data.organization,
          lastLoginAt: data.lastLoginAt,
          createdAt: data.createdAt,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load profile");
      } finally {
        setLoading(false);
      }
    }
    fetchProfile();
  }, [hydrateProfile]);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const data = await apiPut<ProfileData>("/api/v1/auth/me", {
        name: name || null,
        bio: bio || null,
        organization: organization || null,
        avatarUrl: avatarUrl || null,
      });
      setProfile(data);
      hydrateProfile({
        name: data.name,
        avatarUrl: data.avatarUrl,
        bio: data.bio,
        organization: data.organization,
      });
      setSuccess("Profile updated successfully");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }

    setChangingPassword(true);
    try {
      await apiPost("/api/v1/auth/change-password", {
        currentPassword,
        newPassword,
      });
      setPasswordSuccess("Password changed successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setPasswordSuccess(null), 3000);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setChangingPassword(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-sdm-accent" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold text-sdm-heading">Profile</h1>

      <form onSubmit={handleSaveProfile} className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <User className="h-5 w-5 text-sdm-accent" />
          <h2 className="text-lg font-medium text-sdm-heading">Profile Information</h2>
        </div>

        <div>
          <label className="block text-xs font-medium text-sdm-muted mb-1">Email</label>
          <input
            type="email"
            value={profile?.email || user?.email || ""}
            disabled
            className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-muted cursor-not-allowed"
          />
        </div>

        <div>
          <label htmlFor="name" className="block text-xs font-medium text-sdm-muted mb-1">Name</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:outline-none focus:ring-1 focus:ring-sdm-accent/50"
          />
        </div>

        <div>
          <label htmlFor="bio" className="block text-xs font-medium text-sdm-muted mb-1">Bio</label>
          <textarea
            id="bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Tell us about yourself"
            rows={3}
            className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:outline-none focus:ring-1 focus:ring-sdm-accent/50 resize-none"
          />
        </div>

        <div>
          <label htmlFor="organization" className="block text-xs font-medium text-sdm-muted mb-1">Organization</label>
          <input
            id="organization"
            type="text"
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            placeholder="Your organization or institution"
            className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:outline-none focus:ring-1 focus:ring-sdm-accent/50"
          />
        </div>

        <div>
          <label htmlFor="avatarUrl" className="block text-xs font-medium text-sdm-muted mb-1">Avatar URL</label>
          <input
            id="avatarUrl"
            type="text"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://example.com/avatar.jpg"
            className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:outline-none focus:ring-1 focus:ring-sdm-accent/50"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-md bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {success && (
          <div className="flex items-center gap-2 rounded-md bg-sdm-success/10 border border-sdm-success/30 p-3 text-sm text-sdm-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {success}
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white hover:bg-sdm-accent/90 disabled:opacity-50 inline-flex items-center gap-2"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Save Profile
            </>
          )}
        </button>
      </form>

      <form onSubmit={handleChangePassword} className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Lock className="h-5 w-5 text-sdm-accent" />
          <h2 className="text-lg font-medium text-sdm-heading">Change Password</h2>
        </div>

        <div>
          <label htmlFor="currentPassword" className="block text-xs font-medium text-sdm-muted mb-1">Current Password</label>
          <input
            id="currentPassword"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:outline-none focus:ring-1 focus:ring-sdm-accent/50"
          />
        </div>

        <div>
          <label htmlFor="newPassword" className="block text-xs font-medium text-sdm-muted mb-1">New Password</label>
          <input
            id="newPassword"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:outline-none focus:ring-1 focus:ring-sdm-accent/50"
          />
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-xs font-medium text-sdm-muted mb-1">Confirm New Password</label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:outline-none focus:ring-1 focus:ring-sdm-accent/50"
          />
        </div>

        {passwordError && (
          <div className="flex items-center gap-2 rounded-md bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {passwordError}
          </div>
        )}

        {passwordSuccess && (
          <div className="flex items-center gap-2 rounded-md bg-sdm-success/10 border border-sdm-success/30 p-3 text-sm text-sdm-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {passwordSuccess}
          </div>
        )}

        <button
          type="submit"
          disabled={changingPassword}
          className="rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white hover:bg-sdm-accent/90 disabled:opacity-50 inline-flex items-center gap-2"
        >
          {changingPassword ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Changing...
            </>
          ) : (
            "Change Password"
          )}
        </button>
      </form>
    </div>
  );
}