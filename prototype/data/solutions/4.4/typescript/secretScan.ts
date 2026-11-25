import { accept, replace, success, type Guardrail } from "@harness/api";

const MASK = "[REDACTED]";

/** `MODEL_API_KEY=...`: keep the name, mask the value. */
const ASSIGNMENT = /\b([A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)=\S+/g;

const SECRETS = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /gh[pousr]_[A-Za-z0-9]{36,}/g,
  /github_pat_[A-Za-z0-9_]{22,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/**
 * Masks secrets in tool output before the model sees them. Rewriting is honest here: the tool ran as asked,
 * only what it returned is masked. Register it before the result cap, or a cut could leave half a secret.
 */
export const secretScan: Guardrail = {
  name: "secret-scan",

  afterToolUse(_call, result) {
    if (result.kind !== "success") return accept();
    const masked = SECRETS.reduce((text, secret) => text.replace(secret, MASK), result.content.replace(ASSIGNMENT, `$1=${MASK}`));
    return masked === result.content ? accept() : replace(success(masked));
  },
};
