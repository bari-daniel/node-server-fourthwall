import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { Resend } from 'resend';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

dotenv.config();

// 1. CORS Beállítás
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

// --- 2. RESEND EMAIL CLIENT ---
const resend = new Resend(process.env.RESEND_API_KEY);

// E-mail küldő segédfüggvény prémium Nimbus Tales HTML sablonnal
async function sendPurchaseThankYouEmail(toEmail: string, orderId?: string) {
  console.log(`[EMAIL] Sending thank-you email via Resend API to: ${toEmail}...`);
  
  // Cseréld ki a logó URL-jét a saját tárhelyeden lévő képedre vagy logódra!
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
            
            <!-- Fő kártya konténer -->
            <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background: linear-gradient(180deg, #090e1c 0%, #030407 100%); border: 1px solid #1a233a; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
              
              <!-- Fejléc / Brand rész -->
              <tr>
                <td align="center" style="padding: 35px 20px 20px 20px; border-bottom: 1px solid rgba(207, 168, 86, 0.15);">
                  <img src="${studioLogoUrl}" alt="Nimbus Tales" width="70" height="70" style="display: block; border-radius: 50%; border: 2px solid #cfa856; margin-bottom: 12px; object-fit: cover;" />
                  <h1 style="color: #cfa856; font-size: 22px; margin: 0; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">
                    Nimbus Tales
                  </h1>
                </td>
              </tr>

              <!-- Főtörzs / Üzenet -->
              <tr>
                <td style="padding: 35px 30px; color: #f8f9fa; font-size: 15px; line-height: 1.7;">
                  
                  <p style="margin-top: 0; font-size: 18px; font-weight: 600; color: #ffffff;">
                    Köszönjük a támogatásod! ✨
                  </p>
                  
                  <p style="color: #c5cbd8; margin-bottom: 20px;">
                    Reméljük, minden rendben volt a rendeléssel! Mivel a csomagod már úton van vagy megérkezett, nem is szaporítjuk tovább a szót – csak szerettük volna személyesen is megköszönni, hogy támogatod a <strong>Nimbus Tales</strong>-t.
                  </p>

                  <!-- Belső kártya az értékelésre buzdításhoz -->
                  <div style="background-color: rgba(9, 14, 28, 0.7); border: 1px solid rgba(207, 168, 86, 0.2); border-radius: 12px; padding: 20px; margin: 25px 0; text-align: center;">
                    <div style="font-size: 20px; margin-bottom: 8px;">⭐ ⭐ ⭐ ⭐ ⭐</div>
                    <p style="margin: 0 0 15px 0; font-size: 14px; color: #f8f9fa; font-weight: 500;">
                      Ha van egy szabad perced, nagyon hálásak lennénk, ha írnál egy rövid véleményt a termékről a webshopban!
                    </p>
                    
                    <!-- CTA Gomb -->
                    <table role="presentation" border="0" cellspacing="0" cellpadding="0" align="center" style="margin: 0 auto;">
                      <tr>
                        <td align="center" style="border-radius: 8px; background-color: #cfa856;">
                          <a href="https://www.nimbus-tales.com" target="_blank" style="display: inline-block; padding: 12px 28px; font-size: 14px; color: #030407; font-weight: bold; text-decoration: none; border-radius: 8px; background-color: #cfa856;">
                            Vélemény írása & Webshop
                          </a>
                        </td>
                      </tr>
                    </table>
                  </div>

                  ${orderId ? `<p style="font-size: 12px; color: #6c757d; text-align: center; margin-bottom: 0;">Rendelés azonosító: <span style="color: #cfa856;">#${orderId}</span></p>` : ''}

                </td>
              </tr>

              <!-- Lábléc -->
              <tr>
                <td align="center" style="padding: 20px; background-color: rgba(0, 0, 0, 0.3); border-top: 1px solid #121929; font-size: 12px; color: #6c757d;">
                  <p style="margin: 0 0 6px 0;">© ${new Date().getFullYear()} Nimbus Tales Studio. Minden jog fenntartva.</p>
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
      subject: 'Köszönjük a vásárlást! - Nimbus Tales',
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

// Globális CORS opciók
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

// Healthcheck endpointok
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
}

// 1. Review beküldése
app.post('/api/reviews', async (req: Request<{}, {}, ReviewBody>, res: Response): Promise<void> => {
  try {
    const { productId, authorName, authorEmail, rating, comment } = req.body;

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
        verifiedPurchase: true,
        createdAt: FieldValue.serverTimestamp()
      });
    });

    console.log(`[SUCCESS - 201] Review saved successfully with ID: ${customReviewId}`);
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

// 2. Értékelések lekérése
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
    if (eventType !== 'ORDER_PLACED') {
      res.status(200).json({ received: true, note: `Event type ${eventType || 'UNKNOWN'} ignored` });
      return;
    }

    const rawEmail = payload.data?.email || payload.data?.customer?.email;
    if (!rawEmail) {
      res.status(200).json({ received: true, warning: 'No email found in payload' });
      return;
    }

    const customerEmail = rawEmail.toLowerCase().trim();
    const customerRef = db.collection('verified_customers').doc(customerEmail);

    const offers = payload.data?.offers || [];
    
    const uniqueProductIds: string[] = Array.from(
      new Set(
        offers
          .map((offer: any) => offer.id)
          .filter((id: any): id is string => typeof id === 'string' && id.length > 0)
      )
    );

    if (uniqueProductIds.length > 0) {
      const batch = db.batch();

      batch.set(customerRef, {
        lastOrderAt: FieldValue.serverTimestamp(),
        lastOrderId: payload.data?.id || null,
        purchasedProducts: FieldValue.arrayUnion(...uniqueProductIds)
      }, { merge: true });

      if (eventId) {
        const webhookRef = db.collection('processed_webhooks').doc(eventId);
        batch.set(webhookRef, {
          processedAt: FieldValue.serverTimestamp(),
          type: eventType
        });
      }

      await batch.commit();

      console.log('[EMAIL] Starting thank-you email via Resend:', customerEmail);
      await sendPurchaseThankYouEmail(customerEmail, payload.data?.id);
      console.log('[EMAIL] Thank-you email function finished');
    }

    console.log(`[WEBHOOK SUCCESS] Registered ${customerEmail} | Products:`, uniqueProductIds);
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
