import { Hono } from "hono";
import type { Scheduler } from "../scheduler";

export function createStatusRoute(scheduler: Scheduler) {
  const status = new Hono();

  status.get("/", (c) => {
    return c.json(scheduler.getHealth());
  });

  return status;
}
