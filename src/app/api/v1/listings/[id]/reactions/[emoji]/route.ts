import * as h from '@/server/api/handlers';
import { methodNotAllowed } from '@/server/api/http';

export const dynamic = 'force-dynamic';

export const PUT = h.putReaction;
export const DELETE = h.deleteReaction;
export const { GET, POST, PATCH } = methodNotAllowed('PUT', 'DELETE');
