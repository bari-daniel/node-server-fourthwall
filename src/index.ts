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
  rating: number;
  comment: string;
}

// 1. Új értékelés beküldése
app.post('/api/reviews', async (req: Request<{}, {}, ReviewBody>, res: Response) => {
  try {
    const { productId, authorName, rating, comment } = req.body;

    if (!productId || !authorName || !rating || rating < 1 || rating > 5) {
      res.status(400).json({ error: 'Érvénytelen adatok' });
      return;
    }

    const reviewRef = await db.collection('reviews').add({
      productId,
      authorName,
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
      .orderBy('createdAt', 'desc')
      .get();

    const reviews = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate() || null
    }));

    res.json(reviews);
  } catch (error) {
    console.error('Hiba az értékelések lekérésekor:', error);
    res.status(500).json({ error: 'Szerver hiba' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend fut a következő porton: ${PORT}`);
});