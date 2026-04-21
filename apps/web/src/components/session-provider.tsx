"use client";

import type { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";

interface AppSessionProviderProps {
  children: ReactNode;
}

export function AppSessionProvider({ children }: AppSessionProviderProps) {
  return <SessionProvider>{children}</SessionProvider>;
}
