// One share path for every "send this to a friend" button: native share sheet on phones,
// clipboard elsewhere. Resolves with what happened so the button can say so.

export async function shareLink(text: string, url: string): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  const data = { title: "MARGIN", text, url };
  // Desktop Safari also has navigator.share (the macOS share menu), so gate on a touch screen:
  // on a laptop one click should just copy the link.
  if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.(data)) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled"; // closed the sheet: not an error
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    return "copied";
  } catch {
    return "failed";
  }
}
