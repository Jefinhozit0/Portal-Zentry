import type { User } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { TERMS_VERSION } from "@shared/termos";
import { buildTermsReport, describeDevice } from "./termsReport";

const NOW = Date.parse("2026-10-13T15:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const login = (clienteId: number, extra: Record<string, unknown>, createdDaysAgo = 10, lastSignIn: string | null = null) =>
  ({ id: `u${clienteId}`, created_at: daysAgo(createdDaysAgo), last_sign_in_at: lastSignIn, app_metadata: { role: "client", cliente_id: clienteId, ...extra }, user_metadata: {} }) as unknown as User;

const clientes = [
  { id: 1, name: "Ana", email: "ana@x.com" },
  { id: 2, name: "Bruno", email: "bruno@x.com" },
  { id: 3, name: "Carla", email: "carla@x.com" },
  { id: 4, name: "Davi", email: "davi@x.com" },
  { id: 5, name: "Elisa", email: "elisa@x.com" },
  { id: 6, name: "Fábio", email: null },
];
const users = [
  login(1, { terms: { version: TERMS_VERSION, accepted_at: daysAgo(9), ip: "1.2.3.4", user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile Safari/604.1" } }, 10, daysAgo(1)),
  login(2, { terms: { version: "2025-01", accepted_at: daysAgo(60) } }, 90, daysAgo(30)),
  login(3, { first_access: { expires_at: daysAgo(-2), sent_at: daysAgo(1), reminded: false } }, 1),
  login(4, { first_access: { expires_at: daysAgo(3), sent_at: daysAgo(10), reminded: true } }, 10),
  login(5, { first_access: null }, 5, daysAgo(4)),
  // A login whose client was removed does not count.
  login(99, { terms: { version: TERMS_VERSION, accepted_at: daysAgo(1) } }),
  { id: "staff", created_at: daysAgo(100), app_metadata: {}, user_metadata: {} } as unknown as User,
];

describe("buildTermsReport", () => {
  const report = buildTermsReport(clientes, users, NOW);
  const situation = (id: number) => report.clients.find((row) => row.id === id)?.situation;

  it("places each client in one situation", () => {
    expect(situation(1)).toBe("aceito");
    expect(situation(2)).toBe("versao-antiga");
    expect(situation(3)).toBe("primeiro-acesso");
    expect(situation(4)).toBe("link-expirado");
    expect(situation(5)).toBe("sem-aceite");
    expect(situation(6)).toBe("sem-login");
  });

  it("totals match the dashboard definition (accepted out of clients with login)", () => {
    expect(report.totals).toMatchObject({ clients: 6, withLogin: 5, accepted: 1, pending: 4, percent: 0.2, withoutLogin: 1, withoutEmail: 1, acceptedLast7Days: 0, medianHoursToAccept: 24 });
  });

  it("keeps the acceptance evidence and lists pending clients first", () => {
    const ana = report.clients.find((row) => row.id === 1)!;
    expect(ana.acceptedIp).toBe("1.2.3.4");
    expect(ana.acceptedDevice).toBe("iPhone · Safari");
    expect(report.clients.at(-1)?.id).toBe(1);
    expect(report.days).toHaveLength(14);
    expect(report.days.reduce((sum, day) => sum + day.accepted, 0)).toBe(1);
    expect(report.days[14 - 1 - 9].accepted).toBe(1);
  });

  it("keeps counting acceptances of a version that is still valid (v1, before the app section)", () => {
    const old = buildTermsReport([{ id: 7, name: "Gil", email: "gil@x.com" }], [login(7, { terms: { version: "2026-10-v1", accepted_at: daysAgo(2) } })], NOW);
    expect(old.clients[0]).toMatchObject({ situation: "aceito", acceptedVersion: "2026-10-v1" });
    expect(old.totals).toMatchObject({ accepted: 1, pending: 0, oldVersion: 0 });
  });

  it("shows who has the app notifications on", () => {
    const withPush = buildTermsReport(clientes, users, NOW, new Map([[1, { devices: 2, installed: true }]]));
    const ana = withPush.clients.find((row) => row.id === 1)!;
    expect(ana).toMatchObject({ notificationDevices: 2, appInstalled: true });
    expect(withPush.clients.find((row) => row.id === 2)).toMatchObject({ notificationDevices: 0, appInstalled: false });
    expect(withPush.totals.withNotifications).toBe(1);
    expect(report.totals.withNotifications).toBe(0);
  });

  it("names common devices", () => {
    expect(describeDevice("Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36")).toBe("Android · Chrome");
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64) Chrome/120.0 Safari/537.36 Edg/120.0")).toBe("Windows · Edge");
    expect(describeDevice(undefined)).toBeNull();
  });
});
