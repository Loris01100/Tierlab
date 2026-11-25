import { createApi } from './api';
import { musicRoutes } from './deezer';

/** Toutes les routes /api de l'application, partagées par le Worker et par Vite. */
export const handleApi = createApi([...musicRoutes]);
