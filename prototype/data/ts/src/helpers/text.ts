/** Small text jobs that come up when you put file contents or command output in front of a model. */
export const text = {
  /** `text` itself when it has at most `maxChars` characters; otherwise its first `maxChars`, then `note` on a line of its own. */
  truncate: (text: string, maxChars: number, note = `[cut at ${maxChars} characters]`): string =>
    text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n${note}`,

  /** The lines of `text` that are not blank, without line endings (`\n` or `\r\n`). */
  nonBlankLines: (text: string): string[] => text.split(/\r?\n/).filter((line) => line.trim() !== ""),
};
