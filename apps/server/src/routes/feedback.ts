import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { feedback } from '../db/schema';

/**
 * Sugerencias y errores: cualquiera manda y ve los suyos; el administrador ve la bandeja y cambia el estado
 * (ver adminOnly en auth.ts).
 */
export async function feedbackRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  app.post('/api/feedback', async (req, reply) => {
    const b = z
      .object({
        kind: z.enum(['sugerencia', 'error']),
        text: z.string().trim().min(3, 'Contá un poco más').max(4000),
        page: z.string().max(200).nullish(),
      })
      .parse(req.body);
    const [row] = db
      .insert(feedback)
      .values({ ...b, userId: req.user!.id, userName: req.user!.name })
      .returning()
      .all();
    return reply.code(201).send(row);
  });

  /** Los que mandó uno, con su estado y la respuesta. */
  app.get('/api/feedback/mine', async (req) =>
    db.select().from(feedback).where(eq(feedback.userId, req.user!.id)).orderBy(desc(feedback.at)).all(),
  );

  /** Bandeja del administrador. */
  app.get('/api/feedback', async () => db.select().from(feedback).orderBy(desc(feedback.at)).limit(500).all());

  app.patch<{ Params: { id: string } }>('/api/feedback/:id', async (req, reply) => {
    const b = z
      .object({ status: z.enum(['nuevo', 'visto', 'resuelto']), reply: z.string().trim().max(4000).nullable() })
      .partial()
      .parse(req.body);
    const [row] = db
      .update(feedback)
      .set({ ...b, updatedAt: new Date() })
      .where(eq(feedback.id, Number(req.params.id)))
      .returning()
      .all();
    return row ?? reply.code(404).send({ error: 'Mensaje inexistente' });
  });
}
