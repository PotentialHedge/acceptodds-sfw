import * as h from '@/server/api/handlers';
import { methodNotAllowed } from '@/server/api/http';

export const dynamic = 'force-dynamic';

export const PUT = h.putListingTags;
export const { GET, POST, PATCH, DELETE } = methodNotAllowed('PUT');
