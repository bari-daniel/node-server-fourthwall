import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

dotenv.config();

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();
const app = express();

app.use(cors({ origin: true }));
app.use(express.json());

interface ReviewBody {
  productId: string;
  authorName: string;
  authorEmail: string;
  rating: number;
  comment: string;
}

app.post('/api/reviews', async (req: Request<{}, {}, ReviewBody>, res: Response): Promise<void> => {
  try {
    const { productId, authorName, authorEmail, rating, comment } = req.body;

    // Validáció
    if (!productId || !authorName || !authorEmail || !rating || rating < 1 || rating > 5 || !comment?.trim()) {
      res.status(400).json({ error: 'All fields are required, and rating must be between 1 and 5.' });
      return;
    }

    const cleanEmail = authorEmail.toLowerCase().trim();

    const customerDoc = await db.collection('verified_customers').doc(cleanEmail).get();

    if (!customerDoc.exists) {
      res.status(403).json({ 
        error: 'No order found for this email address. Only verified buyers can submit a review.' 
      });
      return;
    }

    const existingReviewSnapshot = await db.collection('reviews')
      .where('productId', '==', productId)
      .where('authorEmail', '==', cleanEmail)
      .limit(1)
      .get();

    if (!existingReviewSnapshot.empty) {
      res.status(409).json({ 
        error: 'You have already submitted a review for this product.' 
      });
      return;
    }

    const reviewRef = await db.collection('reviews').add({
      productId,
      authorName: authorName.trim(),
      authorEmail: cleanEmail,
      rating: Number(rating),
      comment: comment.trim(),
      verifiedPurchase: true,
      createdAt: FieldValue.serverTimestamp()
    });

    res.status(201).json({ success: true, id: reviewRef.id });
  } catch (error) {
    console.error('Error saving review:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

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

    // Rendezés csökkenő sorrendbe dátum szerint
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

// 3. Fourthwall Webhook fogadása
app.post('/api/webhooks/fourthwall', async (req: Request, res: Response): Promise<void> => {
  try {
    const event = req.body;

    console.log('Fourthwall Webhook received:', event.type || 'Unknown type');

    if (event.type === 'order.created' || event.type === 'order.fulfilled') {
      const orderData = event.data;
      const rawEmail = orderData?.email || orderData?.customer?.email;

      if (rawEmail) {
        const customerEmail = rawEmail.toLowerCase().trim();
        await db.collection('verified_customers').doc(customerEmail).set({
          lastOrderAt: FieldValue.serverTimestamp(),
          lastOrderId: orderData.id || null
        }, { merge: true });

        console.log(`Verified customer registered/updated: ${customerEmail}`);
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook error.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend server running on port: ${PORT}`);
});
