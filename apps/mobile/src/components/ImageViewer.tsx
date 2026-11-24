/** A post's photos full screen, one at a time, swiped sideways (apps/web/src/components/ImageViewer.tsx). */
import { FlatList, Modal, Pressable, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mediaSource, type Image as Img } from '@/lib/api';
import { Text } from './ui';

export function ImageViewer({ images, index, onClose, alt }: { images: Img[]; index: number | null; onClose: () => void; alt: (i: number) => string }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={index !== null} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.94)' }}>
        <FlatList
          data={images}
          horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          initialScrollIndex={index ?? 0}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          keyExtractor={(im) => im.id}
          renderItem={({ item, index: i }) => (
            <Pressable onPress={onClose} style={{ width, height, justifyContent: 'center' }} accessibilityLabel="Close">
              <Image source={mediaSource(item.url)} style={{ width, height: height * 0.8 }} contentFit="contain" accessibilityLabel={alt(i)} />
            </Pressable>
          )}
        />
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close"
          style={{ position: 'absolute', top: insets.top + 8, right: 16, borderWidth: 2, borderColor: '#fff', paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text v="ui" style={{ color: '#fff' }}>Close</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
