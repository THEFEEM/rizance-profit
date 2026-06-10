import { z } from "zod";

export const contextPatchSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("regular") }),
  z.object({
    mode: z.literal("booth"),
    boothId: z.string().uuid(),
  }),
]);
