import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

dotenv.config();

// 1. CORS szigorítása production környezetben
const allowedOrigin = process.env.ALLOWED_ORIGIN;
if (!allowedOrigin && process.env.NODE_ENV === 'production') {
  console.error('[FATAL SECURITY ERROR] ALLOWED_ORIGIN is not defined in environment variables.');
  process.exit(1);
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();
const app = express();

// CORS kizárólag a böngészős/Angular API hívásokhoz
const corsMiddleware = cors({ origin: allowedOrigin || '*' });

// Nyers test (rawBody) megtartása a Base64 HMAC aláírás ellenőrzéséhez
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

// 1. Review beküldése (CORS-al védett API, Atomikus Tranzakció + Zéro-Fallback)
app.post('/api/reviews', corsMiddleware, async (req: Request<{}, {}, ReviewBody>, res: Response): Promise<void> => {
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

    // Atomikus Firestore Tranzakció
    await db.runTransaction(async (transaction) => {
      const customerDoc = await transaction.get(customerRef);

      if (!customerDoc.exists) {
        throw new Error('NO_PURCHASE_RECORD');
      }

      const customerData = customerDoc.data();
      const purchasedProducts: string[] = customerData?.purchasedProducts || [];

      // Szigorú ellenőrzés: ha a kanonikus offer.id nincs a tömbben, elutasítjuk
      if (!purchasedProducts.includes(cleanProductId)) {
        throw new Error('PRODUCT_NOT_PURCHASED');
      }

      // Duplikáció ellenőrzése
      const reviewDoc = await transaction.get(reviewRef);
      if (reviewDoc.exists) {
        throw new Error('REVIEW_ALREADY_EXISTS');
      }

      // Mentés
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

// 2. Értékelések lekérése (CORS-al védett API)
app.get('/api/reviews/:productId', corsMiddleware, async (req: Request, res: Response): Promise<void> => {
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

// 3. Fourthwall Webhook Handler (CORS-mentes, KIZÁRÓLAG ORDER_PLACED + Kanonikus ID)
app.post('/api/webhooks/fourthwall', async (req: Request, res: Response): Promise<void> => {
  try {
    const webhookSecret = process.env.FOURTHWALL_WEBHOOK_SECRET;

    // A. HMAC-SHA256 Base64 ellenőrzés
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

    // B. Atomikus Idempotencia (.create())
    if (eventId) {
      try {
        await db.collection('processed_webhooks').doc(eventId).create({
          processedAt: FieldValue.serverTimestamp(),
          type: payload.type || payload.event || 'UNKNOWN'
        });
      } catch (err: any) {
        if (err.code === 6 || err.message?.includes('ALREADY_EXISTS')) {
          console.log(`[WEBHOOK DUPLICATE] Event ${eventId} already processed atomically.`);
          res.status(200).json({ received: true, note: 'Event already processed' });
          return;
        }
        throw err;
      }
    }

    // C. KIZÁRÓLAG ORDER_PLACED esemény feldolgozása
    const eventType = (payload.type || payload.event || '').toUpperCase();
    if (eventType !== 'ORDER_PLACED') {
      res.status(200).json({ received: true, note: `Event type ${eventType || 'UNKNOWN'} ignored` });
      return;
    }

    // D. E-mail kinyerése
    const rawEmail = payload.data?.email || payload.data?.customer?.email;
    if (!rawEmail) {
      res.status(200).json({ received: true, warning: 'No email found in payload' });
      return;
    }

    const customerEmail = rawEmail.toLowerCase().trim();
    const customerRef = db.collection('verified_customers').doc(customerEmail);

    // E. Kanonikus offer.id kinyerése (data.offers[])
    const offers = payload.data?.offers || [];
    
    const uniqueProductIds: string[] = Array.from(
      new Set(
        offers
          .map((offer: any) => offer.id)
          .filter((id: any): id is string => typeof id === 'string' && id.length > 0)
      )
    );

    // F. Vásárlás elmentése
    if (uniqueProductIds.length > 0) {
      await customerRef.set({
        lastOrderAt: FieldValue.serverTimestamp(),
        lastOrderId: payload.data?.id || null,
        purchasedProducts: FieldValue.arrayUnion(...uniqueProductIds)
      }, { merge: true });
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
