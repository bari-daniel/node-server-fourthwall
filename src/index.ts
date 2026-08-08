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

interface ReviewBody {
  productId: string;
  authorName: string;
  authorEmail?: string; // Hozzáadva a webhook azonosításhoz
  rating: number;
  comment: string;
}

// 1. Új értékelés beküldése
app.post('/api/reviews', async (req: Request<{}, {}, ReviewBody>, res: Response) => {
  try {
    const { productId, authorName, authorEmail, rating, comment } = req.body;

    if (!productId || !authorName || !rating || rating < 1 || rating > 5) {
      res.status(400).json({ error: 'Érvénytelen adatok' });
      return;
    }

    const reviewRef = await db.collection('reviews').add({
      productId,
      authorName,
      authorEmail: authorEmail ? authorEmail.toLowerCase().trim() : '', // Kisbetűsítve az egyezéshez
      rating,
      comment: comment || '',
      verifiedPurchase: false,
      createdAt: FieldValue.serverTimestamp()
    });

    res.status(201).json({ success: true, id: reviewRef.id });
  } catch (error) {
    console.error('Hiba az értékelés mentésekor:', error);
    res.status(500).json({ error: 'Szerver hiba' });
  }
});

// 2. Értékelések lekérése egy konkrét termékhez
app.get('/api/reviews/:productId', async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    
    const snapshot = await db.collection('reviews')
      .where('productId', '==', productId)
      .get();

    const reviews = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate() || null
      };
    });

    // Memóriában rendezzük le csökkenő sorrendbe
    reviews.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });

    res.json(reviews);
  } catch (error) {
    console.error('Hiba az értékelések lekérésekor:', error);
    res.status(500).json({ error: 'Szerver hiba' });
  }
});

// 3. Fourthwall Webhook fogadása
app.post('/api/webhooks/fourthwall', async (req: Request, res: Response) => {
  try {
    const event = req.body;

    console.log('Fourthwall Webhook érkezett:', event.type || 'Ismeretlen típus');

    if (event.type === 'order.created' || event.type === 'order.fulfilled') {
      const orderData = event.data;
      const rawEmail = orderData?.email || orderData?.customer?.email;

      if (rawEmail) {
        const customerEmail = rawEmail.toLowerCase().trim();
        const reviewsRef = db.collection('reviews');
        const snapshot = await reviewsRef.where('authorEmail', '==', customerEmail).get();

        if (!snapshot.empty) {
          const batch = db.batch();
          snapshot.docs.forEach(doc => {
            batch.update(doc.ref, { verifiedPurchase: true });
          });

          await batch.commit();
          console.log(`Verified status frissítve a következő emailhez: ${customerEmail}`);
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Hiba a webhook feldolgozásakor:', error);
    res.status(500).json({ error: 'Webhook hiba' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend fut a következő porton: ${PORT}`);
});
