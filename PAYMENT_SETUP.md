# ════════════════════════════════════════════════════════════════
# PAYMENT & FULFILLMENT WORKFLOW
# ════════════════════════════════════════════════════════════════

This document explains exactly how you will process payments and deliver licenses to your customers.

## The Business Model
- **No public website required.**
- The extension is installed for free from the Chrome Web Store.
- Customers hit a "Pro Gate" (e.g., trying to use Batch Processing).
- They click "Upgrade to Pro".
- A modal opens *inside the extension* showing pricing and payment instructions.

## The Customer Journey

1. **Customer decides to buy.** They select "Pro Yearly".
2. **Customer selects PayPal.** The extension tells them to send $79.00 to `your-paypal@example.com` and include the note "ASMP Pro License".
3. **Customer pays.** They send the money via PayPal.
4. **Customer contacts you.** They email `support@example.com` with their PayPal Transaction ID.

## Your Fulfillment Process

1. **Verify Payment.** You log into your PayPal account and verify that the payment was received and cleared.
2. **Generate License.** Open your terminal and run the private admin tool:
   ```bash
   cd license-admin
   npm run license -- --email customer@their-email.com --plan pro_yearly --ref "PAYPAL-TX-123456"
   ```
3. **Copy the Code.** The CLI will output a block like this:
   ```
   ┌────────────────────────────────────────────────┐
   │ LICENSE CODE (send this to the customer):      │
   │                                                │
   │  ASMP-PROYEAR-eyJsaWNlbnNlSWQiOiJBU01QLUgzSDI...
   │  ...
   └────────────────────────────────────────────────┘
   ```
4. **Send to Customer.** Reply to the customer's email:
   > "Thank you for your purchase! Here is your Pro license code:
   > `ASMP-PROYEAR-eyJsaWNlbnNlSWQiOiJBU01QLUgzSDI...`
   >
   > To activate: Open the extension > Go to the License tab > Paste this code > Click Activate."

5. **Customer Activates.** The customer pastes the code, the extension verifies the signature, and Pro features are unlocked instantly.

## Automation (Optional Future Upgrade)
If you want to automate this in the future, you can build a script that listens to PayPal webhooks, runs the `LicenseGenerator` node module to create the license, and uses nodemailer to send the email automatically. For now, the manual process allows you to launch immediately without building complex payment infrastructure.
