"""Piloto local de contagem de pessoas. Não salva nem envia imagens."""
from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import sys
import time
from urllib.error import URLError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from urllib.parse import urlsplit
from uuid import uuid4

import cv2

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def publicar(porta, local, pessoas):
    payload = json.dumps({"place": local, "people": pessoas, "wait": None, "key": str(uuid4())}).encode()
    req = Request(f"http://127.0.0.1:{porta}/api/operacao/medir", data=payload,
                  headers={"Content-Type": "application/json"}, method="POST")
    with build_opener(ProxyHandler({}), NoRedirect()).open(req, timeout=4) as response:
        if response.status != 200:
            raise RuntimeError("O painel não confirmou a leitura.")

def zona(raw):
    try:
        rect = tuple(map(float, raw.split(",")))
        if len(rect) == 4 and all(math.isfinite(x) and 0 <= x <= 1 for x in rect):
            x1, y1, x2, y2 = rect
            if x1 < x2 and y1 < y2:
                return rect
    except ValueError:
        pass
    raise argparse.ArgumentTypeError("Use x1,y1,x2,y2 entre 0 e 1, com coordenadas crescentes.")

def contar(detector, frame, roi, score):
    height, width = frame.shape[:2]
    x1,y1,x2,y2 = roi
    crop = frame[int(y1*height):int(y2*height), int(x1*width):int(x2*width)]
    h,w = crop.shape[:2]
    if min(w/64, h/128) < 1:
        raise ValueError("O enquadramento é pequeno demais para esse detector.")
    if max(w,h) > 960:
        scale = 960/max(w,h)
        crop = cv2.resize(crop, (max(1, round(w*scale)), max(1, round(h*scale))), interpolation=cv2.INTER_AREA)
    h,w = crop.shape[:2]
    if w < 64 or h < 128:
        raise ValueError("A região ficou pequena depois da redução; use uma região menos estreita.")
    if len(crop.shape) == 3:
        crop = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    boxes, weights = detector.detectMultiScale(crop, hitThreshold=score, winStride=(8,8), padding=(8,8), scale=1.05)
    if len(boxes) == 0:
        return 0
    return len(cv2.dnn.NMSBoxes(boxes.tolist(), weights.reshape(-1).tolist(), score, 0.45))

def relatar(args, detector, frame, fonte):
    pessoas = contar(detector, frame, args.zona, args.score)
    resultado = {"fonte": fonte, "local": args.local, "pessoas_detectadas": pessoas, "publicado": False}
    if args.publicar_local:
        publicar(args.porta, args.local, pessoas)
        resultado["publicado"] = True
    print(json.dumps(resultado, ensure_ascii=False), flush=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sources = parser.add_mutually_exclusive_group(required=True)
    sources.add_argument("--imagem", type=Path)
    sources.add_argument("--video", type=Path)
    sources.add_argument("--camera", action="store_true", help="Canal autorizado; URL em MESA_CAMERA_URL.")
    parser.add_argument("--zona", type=zona, default=(0,0,1,1))
    parser.add_argument("--local", choices=("churrasqueira", "buffet"), default="churrasqueira")
    parser.add_argument("--intervalo", type=float, default=5)
    parser.add_argument("--score", type=float, default=0.25)
    parser.add_argument("--leituras", type=int, default=0, help="0 para continuar até o fim da fonte.")
    parser.add_argument("--porta", type=int, default=8000)
    parser.add_argument("--publicar-local", action="store_true", help="Grava somente a contagem no painel local.")
    args = parser.parse_args()
    if not 2 <= args.intervalo <= 90 or not 0 <= args.score <= 5 or not 1 <= args.porta <= 65535 or args.leituras < 0:
        parser.error("Revise intervalo, score, porta e limite de leituras.")
    detector = cv2.HOGDescriptor()
    detector.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
    cap = None
    if hasattr(cv2, "setLogLevel"):
        cv2.setLogLevel(0)
    try:
        if args.imagem:
            if not args.imagem.is_file():
                raise ValueError("Arquivo de imagem inexistente.")
            frame = cv2.imread(str(args.imagem))
            if frame is None:
                raise ValueError("Imagem inválida.")
            relatar(args, detector, frame, "imagem de teste")
            return 0
        if args.camera:
            url = os.getenv("MESA_CAMERA_URL", "")
            parsed = urlsplit(url)
            if parsed.scheme not in ("rtsp", "rtsps") or not parsed.hostname:
                raise ValueError("Configure uma URL RTSP/RTSPS autorizada em MESA_CAMERA_URL.")
            cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG, [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000])
            fonte = "canal de câmera"
        else:
            if not args.video.is_file():
                raise ValueError("Arquivo de vídeo inexistente.")
            cap = cv2.VideoCapture(str(args.video))
            fonte = "vídeo de teste"
        if not cap.isOpened():
            raise ValueError("Não foi possível abrir a fonte de vídeo.")
        count = 0
        next_sample = time.monotonic()
        if args.video:
            fps = cap.get(cv2.CAP_PROP_FPS) or 25
            if not math.isfinite(fps) or fps < 1:
                fps = 25
            stride = max(1, round(fps * args.intervalo))
        while not args.leituras or count < args.leituras:
            ok, frame = cap.read()
            if not ok:
                if args.camera or count == 0:
                    raise ValueError("Não recebi quadros da fonte. Nenhuma leitura zero foi enviada no lugar.")
                break
            if args.video or time.monotonic() >= next_sample:
                if args.video and args.publicar_local:
                    time.sleep(max(0, next_sample - time.monotonic()))
                relatar(args, detector, frame, fonte)
                count += 1
                next_sample = time.monotonic() + args.intervalo
                if args.video and not all(cap.grab() for _ in range(stride - 1)):
                    break
        return 0
    except (ValueError, cv2.error, URLError, TimeoutError, RuntimeError) as error:
        print(str(error) if isinstance(error, ValueError) else "Falha ao processar a fonte ou enviar leitura ao painel local.", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 0
    finally:
        if cap is not None:
            cap.release()

if __name__ == "__main__":
    sys.exit(main())
