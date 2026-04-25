"use client";
import { useEffect, useState } from "react";
import type { PermissionKey, PermissionMap } from "@/lib/security/rbac/permissions";

interface PermissionsState {
  loading: boolean;
  userId: string | null;
  orgId: string | null;
  role: string | null;
  customRoleName: string | null;
  permissions: PermissionMap;
  can: (permission: PermissionKey) => boolean;
  refresh: () => Promise<void>;
}

// Cache simples em memória (dedup entre componentes)
let cached: { ts: number; data: any } | null = null;
const TTL_MS = 60_000;

export function usePermissions(): PermissionsState {
  const [state, setState] = useState<{
    loading: boolean;
    userId: string | null;
    orgId: string | null;
    role: string | null;
    customRoleName: string | null;
    permissions: PermissionMap;
  }>({
    loading: true,
    userId: null,
    orgId: null,
    role: null,
    customRoleName: null,
    permissions: {},
  });

  async function load(force = false) {
    if (!force && cached && Date.now() - cached.ts < TTL_MS) {
      setState({
        loading: false,
        userId: cached.data.userId,
        orgId: cached.data.orgId,
        role: cached.data.role,
        customRoleName: cached.data.customRoleName,
        permissions: cached.data.permissions,
      });
      return;
    }
    try {
      const res = await fetch("/api/auth/permissions", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      cached = { ts: Date.now(), data };
      setState({
        loading: false,
        userId: data.userId,
        orgId: data.orgId,
        role: data.role,
        customRoleName: data.customRoleName,
        permissions: data.permissions,
      });
    } catch (err) {
      console.error("[usePermissions] failed", err);
      setState({
        loading: false,
        userId: null,
        orgId: null,
        role: null,
        customRoleName: null,
        permissions: {},
      });
    }
  }

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    ...state,
    can: (permission) => state.permissions[permission] === true,
    refresh: () => load(true),
  };
}
