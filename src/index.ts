import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { Resend } from 'resend';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

dotenv.config();

// 1. CORS Setup
const rawAllowedOrigins = process.env.ALLOWED_ORIGIN || '';
const allowedOrigins = rawAllowedOrigins
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

if (allowedOrigins.length === 0 && process.env.NODE_ENV === 'production') {
  console.error('[FATAL SECURITY ERROR] ALLOWED_ORIGIN is not defined in environment variables.');
  process.exit(1);
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();
const app = express();

// --- RESEND EMAIL CLIENT ---
const resend = new Resend(process.env.RESEND_API_KEY);

// --- CLOUDFLARE WORKER DISCORD ORDER DISPATCHER ---
async function sendDiscordOrderNotification(order: {
  orderId?: string;
  customerName: string;
  customerEmail?: string;
  totalAmount?: string;
  currency?: string;
  products?: {
    name: string;
    quantity: number;
  }[];
}) {
  const workerUrl = process.env.DISCORD_WORKER_WEBHOOK_URL;
  const workerToken = process.env.WORKER_AUTH_TOKEN;

  if (!workerUrl || !workerToken) {
    console.error('[DISCORD] Worker webhook configuration missing (DISCORD_WORKER_WEBHOOK_URL or WORKER_AUTH_TOKEN).');
    return;
  }

  try {
    const response = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${workerToken}`,
      },
      body: JSON.stringify({
        orderId: order.orderId || 'Unknown',
        customerName: order.customerName,
        customerEmail: order.customerEmail || 'No Email Provided',
        totalAmount: order.totalAmount || '0.00',
        currency: order.currency || 'USD',
        products: order.products || [],
      }),
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(`[DISCORD] Worker returned HTTP ${response.status}:`, responseText);
      return;
    }

    console.log('[DISCORD SUCCESS] Order notification sent through Worker:', responseText);
  } catch (error) {
    console.error('[DISCORD ERROR] Failed to call Discord Worker:', error);
  }
}

// --- CLOUDFLARE WORKER DISCORD REVIEW DISPATCHER ---
async function sendDiscordReviewNotification(review: {
  reviewId: string;
  productId: string;
  authorName: string;
  authorEmail: string;
  rating: number;
  comment: string;
  imageUrl?: string;
}) {
  const workerBaseUrl = process.env.DISCORD_WORKER_WEBHOOK_URL;
  const workerToken = process.env.WORKER_AUTH_TOKEN;

  if (!workerBaseUrl || !workerToken) {
    console.error('[DISCORD REVIEW] Worker configuration missing.');
    return;
  }

  // Automatikusan kicseréli a /webhook/sale végződést /webhook/review-ra
  const reviewWorkerUrl = workerBaseUrl.replace(/\/webhook\/sale\/?$/, '/webhook/review');

  try {
    const response = await fetch(reviewWorkerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${workerToken}`,
      },
      body: JSON.stringify(review),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[DISCORD REVIEW ERROR] HTTP ${response.status}:`, text);
      return;
    }

    console.log('[DISCORD REVIEW SUCCESS] Review notification sent through Worker!');
  } catch (error) {
    console.error('[DISCORD REVIEW ERROR] Failed to send review notification:', error);
  }
}

// Email helper function for purchase thank-you emails
async function sendPurchaseThankYouEmail(
  toEmail: string, 
  customerName?: string, 
  orderId?: string
) {
  console.log(`[EMAIL] Sending thank-you email via Resend API to: ${toEmail}...`);
  
  const studioLogoUrl = 'https://www.nimbus-tales.com/images/nimbusTales.png'; 
  
  const fourthwallOrderUrl = orderId 
    ? `https://nimbus-tales-studio-shop.fourthwall.com/order/${orderId}/status`
    : 'https://nimbus-tales-studio-shop.fourthwall.com/contact/something-else';

  const shopReviewUrl = 'https://www.nimbus-tales.com/webshop';
  const greetingName = customerName?.trim() || toEmail;

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
            <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background: linear-gradient(180deg, #090e1c 0%, #030407 100%); border: 1px solid #1a233a; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
              <tr>
                <td align="center" style="padding: 35px 20px 20px 20px; border-bottom: 1px solid rgba(207, 168, 86, 0.15);">
                  <img src="${studioLogoUrl}" alt="Nimbus Tales" width="110" style="display: block; width: 110px; height: auto; border: 0; outline: none; margin-bottom: 12px;" />
                  <h1 style="color: #cfa856; font-size: 22px; margin: 0; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">
                    Nimbus Tales
                  </h1>
                </td>
              </tr>
              <tr>
                <td style="padding: 35px 30px; color: #f8f9fa; font-size: 15px; line-height: 1.7;">
                  <p style="margin-top: 0; font-size: 18px; font-weight: 600; color: #ffffff;">
                    Thank you for your support, ${greetingName}! ✨
                  </p>
                  <p style="color: #c5cbd8; margin-bottom: 16px;">
                    We wanted to personally thank you for supporting <strong>Nimbus Tales</strong>! Your order is currently being prepared for production and shipment.
                  </p>
                  <p style="color: #c5cbd8; margin-bottom: 20px;">
                    Please note that manufacturing, fulfillment, and shipping are entirely handled by <strong>Fourthwall</strong>. You can track your package or manage order support directly via your <a href="${fourthwallOrderUrl}" target="_blank" style="color: #cfa856; text-decoration: underline;">Fourthwall Order Status Page</a>.
                  </p>
                  <div style="background-color: rgba(9, 14, 28, 0.7); border: 1px solid rgba(207, 168, 86, 0.2); border-radius: 12px; padding: 20px; margin: 25px 0; text-align: center;">
                    <div style="font-size: 20px; margin-bottom: 8px;">⭐ ⭐ ⭐ ⭐ ⭐</div>
                    <p style="margin: 0 0 15px 0; font-size: 14px; color: #f8f9fa; font-weight: 500;">
                      Once your order arrives, we would be deeply grateful if you could take a quick moment to leave a review on our store!
                    </p>
                    <table role="presentation" border="0" cellspacing="0" cellpadding="0" align="center" style="margin: 0 auto;">
                      <tr>
                        <td align="center" style="border-radius: 8px; background-color: #cfa856;">
                          <a href="${shopReviewUrl}" target="_blank" style="display: inline-block; padding: 12px 28px; font-size: 14px; color: #030407; font-weight: bold; text-decoration: none; border-radius: 8px; background-color: #cfa856;">
                            Leave a Review & Visit Shop
                          </a>
                        </td>
                      </tr>
                    </table>
                  </div>
                  ${orderId ? `<p style="font-size: 12px; color: #6c757d; text-align: center; margin-bottom: 0;">Order ID: <span style="color: #cfa856;">#${orderId}</span></p>` : ''}
                </td>
              </tr>
              <tr>
                <td align="center" style="padding: 20px; background-color: rgba(0, 0, 0, 0.3); border-top: 1px solid #121929; font-size: 12px; color: #6c757d;">
                  <p style="margin: 0 0 6px 0;">© ${new Date().getFullYear()} Nimbus Tales Studio. All rights reserved.</p>
                  <p style="margin: 0;">
                    <a href="${shopReviewUrl}" style="color: #cfa856; text-decoration: none;">www.nimbus-tales.com/webshop</a>
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

  const emailText = `Thank you for supporting Nimbus Tales, ${greetingName}! Your order is currently being prepared. Manufacturing, fulfillment, and shipping are handled by Fourthwall. You can check your order status at ${fourthwallOrderUrl}. Once your order arrives, feel free to leave us a review at ${shopReviewUrl} ${orderId ? `(Order ID: #${orderId})` : ''}`;

  try {
    const data = await resend.emails.send({
      from: 'Nimbus Tales <webshop@nimbus-tales.com>',
      to: [toEmail],
      subject: 'Thank you for your purchase! - Nimbus Tales',
      html: emailHtml,
      text: emailText,
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

// Email helper function for review follow-ups
async function sendReviewFollowUpEmail(toEmail: string, authorName: string, rating: number) {
  console.log(`[REVIEW EMAIL] Sending follow-up email for ${rating}-star review to: ${toEmail}...`);

  const studioLogoUrl = 'https://www.nimbus-tales.com/images/nimbusTales.png';
  const fourthwallSupportUrl = 'https://nimbus-tales-studio-shop.fourthwall.com/contact/something-else';
  const shopReviewUrl = 'https://www.nimbus-tales.com/webshop';

  const isPositive = rating > 3;

  const subject = isPositive 
    ? 'Thank you for your wonderful review! - Nimbus Tales' 
    : 'We appreciate your feedback - Nimbus Tales';

  const titleText = isPositive 
    ? `Thank you for your review, ${authorName}! ✨` 
    : `Thank you for your feedback, ${authorName}`;

  const bodyContentHtml = isPositive 
    ? `<p style="color: #c5cbd8; margin-bottom: 16px;">
        We really appreciate you taking the time to share your experience with <strong>Nimbus Tales</strong>! Your support means the world to our team.
       </p>`
    : `<p style="color: #c5cbd8; margin-bottom: 16px;">
        We noticed that your experience wasn't completely seamless. We are truly sorry to hear that and would love to learn more about what went wrong.
       </p>
       <p style="color: #c5cbd8; margin-bottom: 20px;">
        Could you please reply to this email or reach out to us directly to let us know what you found unsatisfactory? We would love to know how we can improve and how we can make things right for you!
       </p>
       <div style="text-align: center; margin: 25px 0;">
         <a href="${fourthwallSupportUrl}" target="_blank" style="display: inline-block; padding: 12px 28px; font-size: 14px; color: #030407; font-weight: bold; text-decoration: none; border-radius: 8px; background-color: #cfa856;">
           Contact Support
         </a>
       </div>`;

  const emailHtml = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${subject}</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #030407; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8f9fa;">
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #030407; padding: 40px 10px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background: linear-gradient(180deg, #090e1c 0%, #030407 100%); border: 1px solid #1a233a; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
              <tr>
                <td align="center" style="padding: 35px 20px 20px 20px; border-bottom: 1px solid rgba(207, 168, 86, 0.15);">
                  <img src="${studioLogoUrl}" alt="Nimbus Tales" width="110" style="display: block; width: 110px; height: auto; border: 0; outline: none; margin-bottom: 12px;" />
                  <h1 style="color: #cfa856; font-size: 22px; margin: 0; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">
                    Nimbus Tales
                  </h1>
                </td>
              </tr>
              <tr>
                <td style="padding: 35px 30px; color: #f8f9fa; font-size: 15px; line-height: 1.7;">
                  <p style="margin-top: 0; font-size: 18px; font-weight: 600; color: #ffffff;">
                    ${titleText}
                  </p>
                  ${bodyContentHtml}
                </td>
              </tr>
              <tr>
                <td align="center" style="padding: 20px; background-color: rgba(0, 0, 0, 0.3); border-top: 1px solid #121929; font-size: 12px; color: #6c757d;">
                  <p style="margin: 0 0 6px 0;">© ${new Date().getFullYear()} Nimbus Tales Studio. All rights reserved.</p>
                  <p style="margin: 0;">
                    <a href="${shopReviewUrl}" style="color: #cfa856; text-decoration: none;">www.nimbus-tales.com/webshop</a>
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

  const emailText = isPositive
    ? `Thank you for your review, ${authorName}! We really appreciate you taking the time to share your experience with Nimbus Tales!`
    : `Thank you for your feedback, ${authorName}. We noticed that your experience wasn't completely seamless. Could you please let us know what you found unsatisfactory and how we can help make things right? Support: ${fourthwallSupportUrl}`;

  try {
    const data = await resend.emails.send({
      from: 'Nimbus Tales <webshop@nimbus-tales.com>',
      to: [toEmail],
      subject: subject,
      html: emailHtml,
      text: emailText,
    });

    if (data.error) {
      console.error(`[REVIEW EMAIL ERROR] Resend returned an error:`, data.error);
    } else {
      console.log(`[REVIEW EMAIL SUCCESS] Email sent successfully! ID:`, data.data?.id);
    }
  } catch (emailError) {
    console.error(`[REVIEW EMAIL ERROR] Failed to send email via Resend to ${toEmail}:`, emailError);
  }
}

// Global CORS options
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.length === 0) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

app.use(express.json({
  verify: (req: any, res, buf) => {
    req.rawBody = buf;
  }
}));

// Healthcheck endpoints
app.get('/', (req: Request, res: Response): void => {
  res.status(200).send('Server is alive and running!');
});

app.get('/health', (req: Request, res: Response): void => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

interface ReviewBody {
  productId: string;
  authorName: string;
  authorEmail: string;
  rating: number;
  comment: string;
  imageUrl?: string;
}

// 1. Submit review endpoint
app.post('/api/reviews', async (req: Request<{}, {}, ReviewBody>, res: Response): Promise<void> => {
  try {
    const { productId, authorName, authorEmail, rating, comment, imageUrl } = req.body;

    if (!productId || !authorName || !authorEmail || !rating || rating < 1 || rating > 5 || !comment?.trim()) {
      res.status(400).json({ error: 'All fields are required, and rating must be between 1 and 5.' });
      return;
    }

    const cleanEmail = authorEmail.toLowerCase().trim();
    const cleanProductId = productId.trim();
    const customReviewId = `${cleanProductId}_${cleanEmail}`;

    const customerRef = db.collection('verified_customers').doc(cleanEmail);
    const reviewRef = db.collection('reviews').doc(customReviewId);

    await db.runTransaction(async (transaction) => {
      const customerDoc = await transaction.get(customerRef);

      if (!customerDoc.exists) {
        throw new Error('NO_PURCHASE_RECORD');
      }

      const customerData = customerDoc.data();
      const purchasedProducts: string[] = customerData?.purchasedProducts || [];

      if (!purchasedProducts.includes(cleanProductId)) {
        throw new Error('PRODUCT_NOT_PURCHASED');
      }

      const reviewDoc = await transaction.get(reviewRef);
      if (reviewDoc.exists) {
        throw new Error('REVIEW_ALREADY_EXISTS');
      }

      transaction.set(reviewRef, {
        productId: cleanProductId,
        authorName: authorName.trim(),
        authorEmail: cleanEmail,
        rating: Number(rating),
        comment: comment.trim(),
        imageUrl: imageUrl || null,
        verifiedPurchase: true,
        createdAt: FieldValue.serverTimestamp()
      });
    });

    console.log(`[SUCCESS - 201] Review saved successfully with ID: ${customReviewId}`);

    // Email küldése a vásárlónak Resend-en keresztül
    sendReviewFollowUpEmail(cleanEmail, authorName.trim(), Number(rating));

    // Discord értesítés küldése a Cloudflare Worker-nek (Név, Email, ID, Csillagok, Komment, Kép)
    sendDiscordReviewNotification({
      reviewId: customReviewId,
      productId: cleanProductId,
      authorName: authorName.trim(),
      authorEmail: cleanEmail,
      rating: Number(rating),
      comment: comment.trim(),
      imageUrl: imageUrl
    });

    res.status(201).json({ success: true, id: customReviewId });

  } catch (error: any) {
    if (error.message === 'NO_PURCHASE_RECORD') {
      res.status(403).json({ error: 'No order found for this email address.' });
      return;
    }
    if (error.message === 'PRODUCT_NOT_PURCHASED') {
      res.status(403).json({ error: 'You can only review products you have actually purchased.' });
      return;
    }
    if (error.message === 'REVIEW_ALREADY_EXISTS') {
      res.status(409).json({ error: 'You have already submitted a review for this product.' });
      return;
    }

    console.error('Error saving review:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// 2. Fetch reviews endpoint
app.get('/api/reviews/:productId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { productId } = req.params;
    
    const snapshot = await db.collection('reviews')
      .where('productId', '==', productId)
      .get();

    const reviews = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        productId: data['productId'],
        authorName: data['authorName'],
        rating: data['rating'],
        comment: data['comment'],
        imageUrl: data['imageUrl'] || null,
        verifiedPurchase: data['verifiedPurchase'],
        createdAt: data['createdAt']?.toDate() || null
      };
    });

    reviews.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });

    res.json(reviews);
  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// 3. Fourthwall Webhook Handler
app.post('/api/webhooks/fourthwall', async (req: Request, res: Response): Promise<void> => {
  try {
    const webhookSecret = process.env.FOURTHWALL_WEBHOOK_SECRET;

    if (webhookSecret) {
      const signatureHeader = (
        req.headers['x-fourthwall-hmac-sha256'] || 
        req.headers['X-Fourthwall-Hmac-SHA256']
      ) as string | undefined;

      if (!signatureHeader) {
        console.warn('[WEBHOOK REJECTED] Missing X-Fourthwall-Hmac-SHA256 header.');
        res.status(401).json({ error: 'Missing signature header' });
        return;
      }

      const rawBody = (req as any).rawBody;
      if (!rawBody) {
        res.status(400).json({ error: 'Raw body unavailable' });
        return;
      }

      const computedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('base64');

      const signatureBuffer = Buffer.from(signatureHeader);
      const computedBuffer = Buffer.from(computedSignature);

      if (
        signatureBuffer.length !== computedBuffer.length ||
        !crypto.timingSafeEqual(signatureBuffer, computedBuffer)
      ) {
        console.warn('[WEBHOOK REJECTED] Signature mismatch.');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }

    const payload = req.body;
    const eventId = payload.id;

    if (eventId) {
      const processedDoc = await db.collection('processed_webhooks').doc(eventId).get();
      if (processedDoc.exists) {
        console.log(`[WEBHOOK DUPLICATE] Event ${eventId} already processed.`);
        res.status(200).json({ received: true, note: 'Event already processed' });
        return;
      }
    }

    const eventType = (payload.type || payload.event || '').toUpperCase();
    console.log(`[WEBHOOK RECEIVED] Processing event type: ${eventType}`);

    // Accepts both ORDER_PLACED and ORDER_CREATED event types
    if (eventType !== 'ORDER_PLACED' && eventType !== 'ORDER_CREATED') {
      res.status(200).json({ received: true, note: `Event type ${eventType || 'UNKNOWN'} ignored` });
      return;
    }

    const rawEmail = payload.data?.email || payload.data?.customer?.email;
    if (!rawEmail) {
      console.warn('[WEBHOOK WARNING] No email found in payload:', JSON.stringify(payload));
      res.status(200).json({ received: true, warning: 'No email found in payload' });
      return;
    }

    const customerEmail = rawEmail.toLowerCase().trim();
    const customerName = payload.data?.customer?.firstName || payload.data?.shippingAddress?.firstName || 'Customer';
    const orderId = payload.data?.id || payload.data?.orderId;
    const customerRef = db.collection('verified_customers').doc(customerEmail);

    const offers = payload.data?.offers || payload.data?.items || [];
    
    // Extract unique product IDs for Firestore authorization
    const uniqueProductIds: string[] = Array.from(
      new Set(
        offers
          .map((offer: any) => offer.id || offer.productId || offer.product?.id)
          .filter((id: any): id is string => typeof id === 'string' && id.length > 0)
      )
    );

    // Format products specifically for the Cloudflare Worker expectation
    const formattedProducts = offers
      .map((offer: any) => ({
        name: offer.name || offer.product?.name || offer.productName || 'Unknown Product',
        quantity: Number(offer.quantity || offer.qty || 1) || 1,
      }))
      .filter((p: { name: string }) => p.name);

    // Save to Firestore
    const batch = db.batch();
    batch.set(customerRef, {
      lastOrderAt: FieldValue.serverTimestamp(),
      lastOrderId: orderId || null,
      purchasedProducts: uniqueProductIds.length > 0 ? FieldValue.arrayUnion(...uniqueProductIds) : []
    }, { merge: true });

    if (eventId) {
      const webhookRef = db.collection('processed_webhooks').doc(eventId);
      batch.set(webhookRef, {
        processedAt: FieldValue.serverTimestamp(),
        type: eventType
      });
    }

    await batch.commit();

    // Send thank-you email via Resend
    console.log('[EMAIL] Starting thank-you email via Resend:', customerEmail);
    await sendPurchaseThankYouEmail(customerEmail, customerName, orderId);

    // CALL CLOUDFLARE WORKER DISCORD BOT FOR ORDERS
    console.log('[DISCORD] Forwarding order details to Cloudflare Worker...');
    await sendDiscordOrderNotification({
      orderId: orderId,
      customerName: customerName,
      customerEmail: customerEmail,
      totalAmount: payload.data?.total || payload.data?.totalPrice || payload.data?.amount,
      currency: payload.data?.currency || payload.data?.currencyCode || 'USD',
      products: formattedProducts
    });

    console.log(`[WEBHOOK SUCCESS] Processed order for ${customerEmail} | Order ID: ${orderId}`);
    res.status(200).json({ received: true, email: customerEmail, products: uniqueProductIds });

  } catch (error) {
    console.error('[WEBHOOK ERROR]:', error);
    res.status(500).json({ error: 'Webhook processing error' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Backend server running on port: ${PORT}`);
});
