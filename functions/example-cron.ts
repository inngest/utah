import { inngest } from "./client.js";

export default inngest.createFunction(
  { id: "example-cron", name: "Example Cron", triggers: [{ cron: "0 */6 * * *" }] },
  async ({ step }) => {
    const result = await step.run("do-work", async () => {
      return {
        message: "Example cron ran",
        timestamp: new Date().toISOString(),
      };
    });
    return result;
  },
);
