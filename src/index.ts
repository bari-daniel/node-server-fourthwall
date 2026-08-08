// E-mail küldő segédfüggvény prémium Nimbus Tales HTML sablonnal
async function sendPurchaseThankYouEmail(toEmail: string, orderId?: string) {
  console.log(`[EMAIL] Sending thank-you email via Resend API to: ${toEmail}...`);
  
  const studioLogoUrl = 'https://www.nimbus-tales.com/images/nimbusTales.png'; 

  const emailHtml = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Thank You from Nimbus Tales</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #030407; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #f8f9fa;">
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #030407; padding: 40px 10px;">
        <tr>
          <td align="center">
            
            <!-- Main Card Container -->
            <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background: linear-gradient(180deg, #090e1c 0%, #030407 100%); border: 1px solid #1a233a; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
              
              <!-- Header / Branding -->
              <tr>
                <td align="center" style="padding: 35px 20px 20px 20px; border-bottom: 1px solid rgba(207, 168, 86, 0.15);">
                  <img src="${studioLogoUrl}" alt="Nimbus Tales" width="70" height="70" style="display: block; border-radius: 50%; border: 2px solid #cfa856; margin-bottom: 12px; object-fit: cover;" />
                  <h1 style="color: #cfa856; font-size: 22px; margin: 0; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">
                    Nimbus Tales
                  </h1>
                </td>
              </tr>

              <!-- Main Body / Message -->
              <tr>
                <td style="padding: 35px 30px; color: #f8f9fa; font-size: 15px; line-height: 1.7;">
                  
                  <p style="margin-top: 0; font-size: 18px; font-weight: 600; color: #ffffff;">
                    Thank you for your support! ✨
                  </p>
                  
                  <p style="color: #c5cbd8; margin-bottom: 16px;">
                    We wanted to personally thank you for supporting <strong>Nimbus Tales</strong>! Your order is currently being prepared for production and shipment.
                  </p>

                  <p style="color: #c5cbd8; margin-bottom: 20px;">
                    Please note that manufacturing, fulfillment, and shipping are entirely handled by <strong>Fourthwall</strong>. If you have any questions regarding your package, tracking, or order support, please reach out directly to <a href="https://support.fourthwall.com" target="_blank" style="color: #cfa856; text-decoration: underline;">Fourthwall Support</a> or reply to your original Fourthwall confirmation email.
                  </p>

                  <!-- Inner Review Card -->
                  <div style="background-color: rgba(9, 14, 28, 0.7); border: 1px solid rgba(207, 168, 86, 0.2); border-radius: 12px; padding: 20px; margin: 25px 0; text-align: center;">
                    <div style="font-size: 20px; margin-bottom: 8px;">⭐ ⭐ ⭐ ⭐ ⭐</div>
                    <p style="margin: 0 0 15px 0; font-size: 14px; color: #f8f9fa; font-weight: 500;">
                      Once your order arrives, we would be deeply grateful if you could take a quick moment to leave a review on our store!
                    </p>
                    
                    <!-- CTA Button -->
                    <table role="presentation" border="0" cellspacing="0" cellpadding="0" align="center" style="margin: 0 auto;">
                      <tr>
                        <td align="center" style="border-radius: 8px; background-color: #cfa856;">
                          <a href="https://www.nimbus-tales.com" target="_blank" style="display: inline-block; padding: 12px 28px; font-size: 14px; color: #030407; font-weight: bold; text-decoration: none; border-radius: 8px; background-color: #cfa856;">
                            Leave a Review & Visit Shop
                          </a>
                        </td>
                      </tr>
                    </table>
                  </div>

                  ${orderId ? `<p style="font-size: 12px; color: #6c757d; text-align: center; margin-bottom: 0;">Order ID: <span style="color: #cfa856;">#${orderId}</span></p>` : ''}

                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td align="center" style="padding: 20px; background-color: rgba(0, 0, 0, 0.3); border-top: 1px solid #121929; font-size: 12px; color: #6c757d;">
                  <p style="margin: 0 0 6px 0;">© ${new Date().getFullYear()} Nimbus Tales Studio. All rights reserved.</p>
                  <p style="margin: 0;">
                    <a href="https://www.nimbus-tales.com" style="color: #cfa856; text-decoration: none;">www.nimbus-tales.com</a>
                  </p>
                </td>
              </tr>

            </table>

          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  try {
    const data = await resend.emails.send({
      from: 'Nimbus Tales <webshop@nimbus-tales.com>',
      to: [toEmail],
      subject: 'Thank you for your purchase! - Nimbus Tales',
      html: emailHtml,
    });

    if (data.error) {
      console.error(`[EMAIL ERROR] Resend returned an error:`, data.error);
    } else {
      console.log(`[EMAIL SUCCESS] Thank-you email sent successfully! ID:`, data.data?.id);
    }
  } catch (emailError) {
    console.error(`[EMAIL ERROR] Failed to send email via Resend to ${toEmail}:`, emailError);
  }
}
