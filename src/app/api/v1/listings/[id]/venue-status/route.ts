import * as h from '@/server/api/handlers';
import { methodNotAllowed } from '@/server/api/http';

export const dynamic = 'force-dynamic';

export const PUT = h.putListingVenueStatus;
export const DELETE = h.deleteListingVenueStatus;
export const { GET, POST, PATCH } = methodNotAllowed('PUT', 'DELETE');
