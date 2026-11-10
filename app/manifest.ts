import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Đoán Nhanh V-pop',
    short_name: 'Đoán Nhanh V-pop',
    description: 'Đoán nhanh bài hát V-pop cùng bạn bè.',
    start_url: '/',
    display: 'standalone',
    lang: 'vi',
    background_color: '#ffffff',
    theme_color: '#ffffff',
  };
}
