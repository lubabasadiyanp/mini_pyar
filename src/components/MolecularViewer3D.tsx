import React, { useEffect, useRef, useState } from 'react';
import * as $3Dmol from '3dmol';

interface MoleculeViewer3DProps {
  xyzData: string;
  style?: 'ballAndStick' | 'stick' | 'sphere';
}

export const MoleculeViewer3D: React.FC<MoleculeViewer3DProps> = ({
  xyzData,
  style: initialStyle = 'ballAndStick',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const [currentStyle, setCurrentStyle] = useState<'ballAndStick' | 'stick' | 'sphere'>(initialStyle);

  // Initialize and render structure
  useEffect(() => {
    if (!containerRef.current || !xyzData) return;

    containerRef.current.innerHTML = '';

    // Create 3Dmol viewer with realistic dark background for depth
    const viewer = $3Dmol.createViewer(containerRef.current, {
      backgroundColor: '#ffffff', // Sleek slate dark background
    });

    viewerRef.current = viewer;

    // Add XYZ model
    viewer.addModel(xyzData, 'xyz');

    // Apply visualization style
    applyStyle(viewer, currentStyle);

    viewer.zoomTo();
    viewer.render();
  }, [xyzData]);

  // Apply style dynamically
  const applyStyle = (viewer: any, styleType: 'ballAndStick' | 'stick' | 'sphere') => {
    if (!viewer) return;

    if (styleType === 'ballAndStick') {
      viewer.setStyle({}, { stick: { radius: 0.14 }, sphere: { scale: 0.28 } });
    } else if (styleType === 'sphere') {
      viewer.setStyle({}, { sphere: { scale: 0.85 } });
    } else {
      viewer.setStyle({}, { stick: { radius: 0.22 } });
    }
    viewer.render();
  };

  const handleStyleChange = (newStyle: 'ballAndStick' | 'stick' | 'sphere') => {
    setCurrentStyle(newStyle);
    applyStyle(viewerRef.current, newStyle);
  };

  // Zoom controls
  const handleZoomIn = () => {
    if (viewerRef.current) {
      viewerRef.current.zoom(1.2, 200); // Smooth zoom in
    }
  };

  const handleZoomOut = () => {
    if (viewerRef.current) {
      viewerRef.current.zoom(0.83, 200); // Smooth zoom out
    }
  };

  const handleReset = () => {
    if (viewerRef.current) {
      viewerRef.current.zoomTo(500); // Smooth reset animation
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '450px', borderRadius: '12px', overflow: 'hidden', border: '1px solid #334155' }}>
      {/* 3D WebGL Canvas Container */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Floating Control Toolbar */}
      <div
        style={{
          position: 'absolute',
          top: '12px',
          right: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          zIndex: 10,
          background: '#ffffff',
          padding: '8px',
          borderRadius: '8px',
          border: '1px solid #cbd5e1',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
        }}
      >
        {/* Zoom In Button */}
        <button
          onClick={handleZoomIn}
          title="Zoom In"
          style={buttonStyle}
        >
          ＋
        </button>

        {/* Zoom Out Button */}
        <button
          onClick={handleZoomOut}
          title="Zoom Out"
          style={buttonStyle}
        >
          －
        </button>

        {/* Reset View Button */}
        <button
          onClick={handleReset}
          title="Reset Camera"
          style={buttonStyle}>↺</button>
        
      </div>

      {/* Style Selector Toolbar (Bottom Left) */}
      <div
        style={{
          position: 'absolute',
          bottom: '12px',
          left: '12px',
          display: 'flex',
          gap: '6px',
          zIndex: 10,
          background: '#ffffff',
          padding: '6px',
          borderRadius: '8px',
          border: '1px solid #cbd5e1',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
        }}
      >
        <button
          onClick={() => handleStyleChange('ballAndStick')}
          style={currentStyle === 'ballAndStick' ? activeStyleBtn : styleBtn}
        >
          Ball & Stick
        </button>
        <button
          onClick={() => handleStyleChange('sphere')}
          style={currentStyle === 'sphere' ? activeStyleBtn : styleBtn}
        >
          Space-Filling
        </button>
        <button
          onClick={() => handleStyleChange('stick')}
          style={currentStyle === 'stick' ? activeStyleBtn : styleBtn}
        >
          Wireframe
        </button>
      </div>
    </div>
  );
};

// Button styling helper
const buttonStyle: React.CSSProperties = {
  width: '32px',
  height: '32px',
  borderRadius: '6px',
  border: '1px solid #e2e8f0',
  backgroundColor: '#f8fafc',
  color: '#0f172a',
  cursor: 'pointer',
  fontSize: '16px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'all 0.2s ease',
};

const styleBtn: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: '12px',
  borderRadius: '6px',
  border: '1px solid #e2e8f0',
  backgroundColor: '#f8fafc',
  color: '#334155',
  cursor: 'pointer',
};

const activeStyleBtn: React.CSSProperties = {
  ...styleBtn,
  backgroundColor: '#2563eb',
  color: '#ffffff',
  borderColor: '#2563eb',
  fontWeight: '600',
};