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

// E-mail küldő segédfüggvény Resend API-val
async function sendPurchaseThankYouEmail(toEmail: string, orderId?: string) {
  console.log(`[EMAIL] Sending email via Resend API to: ${toEmail}...`);
  try {
    const data = await resend.emails.send({
      // Ha a domain még nincs igazolva a Resendben, a teszteléshez használd az 'onboarding@resend.dev' feladót!
      from: 'Nimbus Tales <onboarding@resend.dev>', 
      to: [toEmail],
      subject: 'Thank you for your order! - Nimbus Tales',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; line-height: 1.6;">
          <h2 style="color: #1a1a1a;">Thank you for your purchase!</h2>
          <p>Hi there,</p>
          <p>We have successfully received your order. Thank you so much for supporting <strong>Nimbus Tales</strong>!</p>
          ${orderId ? `<p>Order ID: <strong>${orderId}</strong></p>` : ''}
          <p>As a verified customer, you can now leave a review on the product page. Feel free to share your thoughts and feedback with our community!</p>
          <p>If you have any questions or issues regarding your order, simply reply to this email and we'll be happy to help.</p>
          <br>
          <hr style="border: none; border-top: 1px solid #eee;" />
          <p style="font-size: 12px; color: #777;">Nimbus Tales Studio</p>
        </div>
      `,
    });

    if (data.error) {
      console.error(`[EMAIL ERROR] Resend returned an error:`, data.error);
    } else {
      console.log(`[EMAIL SUCCESS] Resend email sent successfully! Message ID:`, data.data?.id);
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
