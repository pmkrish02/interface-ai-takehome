import dotenv from "dotenv";

dotenv.config();

export function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY is not set. Create a .env file in discovery/ with GEMINI_API_KEY=<key>."
    );
  }
  return key;
}
