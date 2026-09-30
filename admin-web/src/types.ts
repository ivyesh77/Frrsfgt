export const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'GAME_OPERATOR', 'PAYMENT_OPERATOR', 'SUPPORT_AGENT', 'ANALYST', 'READ_ONLY'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export interface PublicAdmin {
  id: string;
  name: string;
  role: AdminRole;
  active: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

export type Permission = string;
