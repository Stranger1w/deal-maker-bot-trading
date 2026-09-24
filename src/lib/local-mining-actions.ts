// Server functions del motor de mineria propio (puente cliente-servidor).
// El trabajo pesado (SHA-256) corre en el navegador; el servidor emite el
// trabajo, verifica shares y acredita DMR. Sin XMRig ni pools externas.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const jobSchema = z.object({
  jobId: z.string().min(1).max(64),
  seed: z.string().min(1).max(64),
  targetZeros: z.number().int().min(1).max(4),
  rewardPerShare: z.number().nonnegative(),
  issuedAt: z.string(),
});

export const getLocalMiningJob = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ wallet: z.string().min(1).max(128) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { issueLocalJob } = await import("./local-mining.server");
    return issueLocalJob(data.wallet.trim());
  });

export const submitLocalMiningShares = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        wallet: z.string().min(1).max(128),
        workerName: z.string().max(60).optional(),
        job: jobSchema,
        shares: z
          .array(z.object({ nonce: z.number().int().nonnegative(), hashHex: z.string().min(1).max(64) }))
          .max(32),
        hashes: z.number().int().nonnegative().max(10_000_000),
        seconds: z.number().min(0.001).max(3600),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { submitLocalShares } = await import("./local-mining.server");
    return submitLocalShares(data as Parameters<typeof submitLocalShares>[0]);
  });

export const stopLocalMining = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ wallet: z.string().min(1).max(128) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { stopLocalWorker } = await import("./local-mining.server");
    return stopLocalWorker(data.wallet.trim());
  });
