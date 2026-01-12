'use client';

import React, { useState, useRef } from 'react';
import ReactCrop, { Crop, PixelCrop, centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

interface Props {
    imageSrc: string;
    onCropComplete: (croppedBlob: Blob) => void;
    onCancel: () => void;
    isUploading?: boolean;
}

export default function ImageCropper({ imageSrc, onCropComplete, onCancel, isUploading }: Props) {
    const [crop, setCrop] = useState<Crop>();
    const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
    const imgRef = useRef<HTMLImageElement>(null);

    const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const { width, height } = e.currentTarget;
        // Default to a 90% wide crop centered without aspect ratio constraint
        const initialCrop = centerCrop(
            {
                unit: '%',
                width: 90,
                height: 90 * (height / width) > 90 ? 80 : 90 * (height / width), // Attempt a reasonable initial box
            },
            width,
            height
        );
        setCrop(initialCrop);
    };

    const handleConfirm = async () => {
        if (!completedCrop || !imgRef.current) return;

        const canvas = document.createElement('canvas');
        const image = imgRef.current;
        const scaleX = image.naturalWidth / image.width;
        const scaleY = image.naturalHeight / image.height;

        canvas.width = completedCrop.width * scaleX;
        canvas.height = completedCrop.height * scaleY;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(
            image,
            completedCrop.x * scaleX,
            completedCrop.y * scaleY,
            completedCrop.width * scaleX,
            completedCrop.height * scaleY,
            0,
            0,
            canvas.width,
            canvas.height
        );

        canvas.toBlob((blob) => {
            if (blob) {
                onCropComplete(blob);
            }
        }, 'image/jpeg', 0.9);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }}>
            <div style={{
                maxHeight: '60vh',
                overflow: 'auto',
                display: 'flex',
                justifyContent: 'center',
                background: '#f0f0f0',
                borderRadius: '8px',
                padding: '10px'
            }}>
                <ReactCrop
                    crop={crop}
                    onChange={(c) => setCrop(c)}
                    onComplete={(c) => setCompletedCrop(c)}
                >
                    <img
                        ref={imgRef}
                        src={imageSrc}
                        alt="Crop me"
                        onLoad={onImageLoad}
                        style={{ maxWidth: '100%', maxHeight: '60vh' }}
                    />
                </ReactCrop>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                    className="btn btn-secondary"
                    onClick={onCancel}
                    disabled={isUploading}
                >
                    Cancel
                </button>
                <button
                    className="btn btn-primary"
                    onClick={handleConfirm}
                    disabled={isUploading || !completedCrop}
                >
                    {isUploading ? 'Uploading...' : 'Confirm & Upload'}
                </button>
            </div>
        </div>
    );
}
