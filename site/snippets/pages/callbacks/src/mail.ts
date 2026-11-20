// The app's emails. Here they're logged, as a test's mailer would.
export async function sendWelcomeEmail(email: string): Promise<void> {
  console.log(`Welcome email to ${email}`);
}

export async function sendShippedEmail(email: string): Promise<void> {
  console.log(`Shipped email to ${email}`);
}
