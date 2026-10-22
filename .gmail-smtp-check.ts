import "dotenv/config";
import { randomInt } from "node:crypto";
import { sendVerificationCodeEmail } from "./server/_core/email";

async function run() {
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await sendVerificationCodeEmail("zentrysolucoes@gmail.com", code);
  console.log("GMAIL_SMTP_TEST_SENT");
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "GMAIL_SMTP_TEST_FAILED");
  process.exitCode = 1;
});
