/**
 * One query cache for the app, saved on the phone (AsyncStorage) so the last feed, people and
 * notifications show at once on the next launch, and while there is no signal. Signing out
 * erases it (session.tsx).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60 * 24,
      staleTime: 15_000,
      networkMode: 'offlineFirst',
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
    },
    mutations: { networkMode: 'online' },
  },
});

export const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: 'anti-cache' });
