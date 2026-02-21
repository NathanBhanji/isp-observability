"use server";

import { revalidatePath } from "next/cache";

const COLLECTOR_URL = process.env.COLLECTOR_URL || "http://localhost:4000";

export async function triggerSpeedTest() {
  try {
    await fetch(`${COLLECTOR_URL}/api/throughput/trigger`, { method: "POST" });
    revalidatePath("/throughput");
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function triggerTraceroute() {
  try {
    await fetch(`${COLLECTOR_URL}/api/traceroute/trigger`, { method: "POST" });
    revalidatePath("/traceroute");
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
