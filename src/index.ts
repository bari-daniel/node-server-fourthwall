import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

dotenv.config();

// Firebase Admin SDK inicializálása
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();
const app = express();

app.use(cors({ origin: true }));
app.use(express.json());

// 0. Healthcheck & Root Endpointok (UptimeRobot pingeléshez és ébrentartáshoz)
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

// 1. Új értékelés beküldése
app.post('/api/reviews', async (req: Request<{}, {}, ReviewBody>, res: Response): Promise<void> => {
  try {
    const { productId, authorName, authorEmail, rating, comment } = req.body;

    // Validáció
    if (!productId || !authorName || !authorEmail || !rating || rating < 1 || rating > 5 || !comment?.trim()) {
      res.status(400).json({ error: 'All fields are required, and rating must be between 1 and 5.' });
      return;
    }

    const cleanEmail = authorEmail.toLowerCase().trim();
    console.log(`\n--- [REVIEW ATTEMPT] --- Email: ${cleanEmail} | ProductId: ${productId}`);

    // A. Vásárlás ellenőrzése a verified_customers kollekcióban
    const customerDoc = await db.collection('verified_customers').doc(cleanEmail).get();

    if (!customerDoc.exists) {
      console.log(`[REJECTED - 403] Customer not found in verified_customers: ${cleanEmail}`);
      res.status(403).json({ 
        error: 'No order found for this email address. Only verified buyers can submit a review.' 
      });
      return;
    }

    // B. Duplikáció ellenőrzése
    let existingReviewSnapshot;
    try {
      existingReviewSnapshot = await db.collection('reviews')
        .where('productId', '==', productId)
        .where('authorEmail', '==', cleanEmail)
        .limit(1)
        .get();
    } catch (indexError: any) {
      console.error('[FIRESTORE INDEX ERROR] Composite index needed:', indexError);
      res.status(500).json({ error: 'Database index error. Check server logs.' });
      return;
    }

    if (!existingReviewSnapshot.empty) {
      console.log(`[REJECTED - 409] Review already exists for email: ${cleanEmail}`);
      res.status(409).json({ 
        error: 'You have already submitted a review for this product.' 
      });
      return;
    }

    // C. Értékelés mentése
    const reviewRef = await db.collection('reviews').add({
      productId,
      authorName: authorName.trim(),
      authorEmail: cleanEmail,
      rating: Number(rating),
      comment: comment.trim(),
      verifiedPurchase: true,
      createdAt: FieldValue.serverTimestamp()
    });

    console.log(`[SUCCESS - 201] Review saved successfully with ID: ${reviewRef.id}`);
    res.status(201).json({ success: true, id: reviewRef.id });
  } catch (error) {
    console.error('Error saving review:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// 2. Értékelések lekérése egy konkrét termékhez
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

// 3. Fourthwall Webhook (Továbbfejlesztett, mély e-mail keresővel)
app.post('/api/webhooks/fourthwall', async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = req.body;

    console.log('\n--- [FOURTHWALL WEBHOOK INCOMING] ---');
    console.log('Event Type:', payload.type || payload.event || payload.topic || 'Direct Payload');

    // Keressük meg az e-mailt a Fourthwall mély struktúráiban
    const rawEmail = 
      payload.data?.email || 
      payload.data?.customer?.email || 
      payload.email || 
      payload.customer?.email || 
      payload.order?.email ||
      payload.order?.customer?.email;

    if (rawEmail) {
      const customerEmail = rawEmail.toLowerCase().trim();

      await db.collection('verified_customers').doc(customerEmail).set({
        lastOrderAt: FieldValue.serverTimestamp(),
        lastOrderId: payload.data?.id || payload.order?.id || payload.id || null
      }, { merge: true });

      console.log(`[WEBHOOK SUCCESS] Verified customer registered: ${customerEmail}`);
      res.status(200).json({ received: true, email: customerEmail });
      return;
    }

    console.log('[WEBHOOK WARNING] Webhook arrived, but no email field was extracted.');
    res.status(200).json({ received: true, warning: 'No email found in payload' });
  } catch (error) {
    console.error('[WEBHOOK ERROR]:', error);
    res.status(500).json({ error: 'Webhook processing error' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Backend server running on port: ${PORT}`);
});
