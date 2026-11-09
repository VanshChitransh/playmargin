// One share path for every "send this to a friend" button: native share sheet on phones,
// clipboard elsewhere. Resolves with what happened so the button can say so.

export async function shareLink(text: string, url: string): Promise<"shared" | "copied" | "failed"> {
  const data = { title: "MARGIN", text, url };
  if (navigator.canShare?.(data)) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "failed";
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    return "copied";
  } catch {
    return "failed";
  }
}
