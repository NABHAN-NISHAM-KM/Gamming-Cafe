/** What the customer reads when adding time fails. */
export function buyTimeMessage(error: string | undefined): string {
  switch (error) {
    case "insufficient_funds": return "Not enough money in your wallet. Top up at the counter or in the Arena app.";
    case "insufficient_time": return "You don't have that much saved time.";
    case "wallet_frozen": return "Your wallet is on hold. Please ask at the counter.";
    case "package_not_found": return "That package isn't available any more.";
    case "session_not_extendable": case "no_session": return "There's no running session to add time to.";
    case "guest": return "Guest sessions are extended at the counter.";
    case "session_changed": return "Your session just changed. Please try again.";
    default: return "Couldn't add time. Please ask at the counter.";
  }
}
