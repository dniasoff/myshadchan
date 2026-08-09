if (data) {
  notify("Purge request submitted successfully", { type: "success" });
  setOpen(true);
  setSingleName("");
  setSingleEmail("");
} else {
  notify("Failed to submit purge request", { type: "error" });
}
