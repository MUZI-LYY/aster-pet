"""Draw Aster's simple star logomark as a PNG, then create a native macOS icon."""
import math,struct,zlib,os
root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def png(path,size,transparent=False):
 data=bytearray();c=size/2
 for y in range(size):
  data.append(0)
  for x in range(size):
   dx=(x+.5-c)/size;dy=(y+.5-c)/size
   corner=max(abs(dx)-.31,0)**2+max(abs(dy)-.31,0)**2
   inside=corner<.175**2
   a=255 if inside else 0
   color=(235,242,224,a) if not transparent else (0,0,0,0)
   r=math.hypot(dx,dy);theta=math.atan2(dy,dx)
   dist=abs(math.sin(theta*4))
   line=dist*r < .015 and .065<r<.30
   if line or r<.023:color=(76,111,66,255) if not transparent else (0,0,0,255)
   data.extend(color)
 def chunk(kind,b):return struct.pack('>I',len(b))+kind+b+struct.pack('>I',zlib.crc32(kind+b)&0xffffffff)
 with open(path,'wb') as f:f.write(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(data))+chunk(b'IEND',b''))
folder=os.path.join(root,'build','Aster.iconset');os.makedirs(folder,exist_ok=True)
for n in [16,32,128,256,512]:
 png(os.path.join(folder,f'icon_{n}x{n}.png'),n)
 png(os.path.join(folder,f'icon_{n}x{n}@2x.png'),n*2)
png(os.path.join(root,'build','tray.png'),32,True)
chunks=[]
for kind,name in [(b'ic07','icon_128x128.png'),(b'ic08','icon_256x256.png'),(b'ic09','icon_512x512.png'),(b'ic10','icon_512x512@2x.png')]:
 with open(os.path.join(folder,name),'rb') as f:payload=f.read()
 chunks.append(kind+struct.pack('>I',len(payload)+8)+payload)
data=b''.join(chunks)
with open(os.path.join(root,'build','Aster.icns'),'wb') as f:f.write(b'icns'+struct.pack('>I',len(data)+8)+data)
