import * as h from '@/server/api/handlers';
import { methodNotAllowed } from '@/server/api/http';

export const dynamic = 'force-dynamic';

export const GET = h.getListingRevision;
export const PUT = h.putListingRevision;
export const DELETE = h.deleteListingRevision;
export const { POST, PATCH } = methodNotAllowed('GET', 'PUT', 'DELETE');
