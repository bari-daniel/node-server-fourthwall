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
    
    // Csak a productId-ra szűrünk (nem kell Firestore index!)
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

    // Memóriában rendezzük le csökkenő sorrendbe (legfrissebb elől)
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend fut a következő porton: ${PORT}`);
});
