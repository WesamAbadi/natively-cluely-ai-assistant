use anyhow::Result;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream};
use ringbuf::{traits::{Producer, Split}, HeapRb, HeapCons};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::audio_config::RING_BUFFER_SAMPLES;

pub fn list_output_devices() -> Result<Vec<(String, String)>> {
    let host = cpal::default_host();
    let mut list = Vec::new();
    list.push(("default".to_string(), "Default Speaker".to_string()));
    
    if let Ok(devices) = host.output_devices() {
        for device in devices {
            if let Ok(name) = device.name() {
                list.push((name.clone(), name));
            }
        }
    }
    Ok(list)
}

pub struct SpeakerInput {
    device: cpal::Device,
    config: cpal::SupportedStreamConfig,
}

impl SpeakerInput {
    pub fn new(device_id: Option<String>) -> Result<Self> {
        let host = cpal::default_host();
        let device = match device_id {
            Some(ref id) if id != "default" => {
                host.output_devices()?
                    .find(|x| x.name().map(|y| y == *id).unwrap_or(false))
                    .unwrap_or_else(|| host.default_output_device().expect("No default output"))
            }
            _ => host.default_output_device()
                .ok_or_else(|| anyhow::anyhow!("No default output device found"))?,
        };
        
        let config = device.default_output_config()
            .map_err(|e| anyhow::anyhow!("Failed to get config: {}", e))?;
        
        Ok(Self { device, config })
    }

    pub fn stream(self) -> SpeakerStream {
        let sample_rate = self.config.sample_rate().0;
        let channels = self.config.channels() as usize;
        
        let rb = HeapRb::<f32>::new(RING_BUFFER_SAMPLES);
        let (mut producer, consumer) = rb.split();
        
        let is_running = Arc::new(AtomicBool::new(true));
        let is_running_clone = is_running.clone();
        
        let err_fn = |err| eprintln!("[SystemAudio] stream error: {}", err);

        let stream_result = match self.config.sample_format() {
            SampleFormat::F32 => {
                self.device.build_input_stream(
                    &self.config.clone().into(),
                    move |data: &[f32], _: &_| {
                        if !is_running_clone.load(Ordering::Relaxed) { return; }
                        if channels > 1 {
                            for chunk in data.chunks(channels) {
                                let _ = producer.try_push(chunk[0]);
                            }
                        } else {
                            let _ = producer.push_slice(data);
                        }
                    },
                    err_fn,
                    None,
                )
            }
            SampleFormat::I16 => {
                self.device.build_input_stream(
                    &self.config.clone().into(),
                    move |data: &[i16], _: &_| {
                        if !is_running_clone.load(Ordering::Relaxed) { return; }
                        if channels > 1 {
                            for chunk in data.chunks(channels) {
                                let _ = producer.try_push(chunk[0] as f32 / 32768.0);
                            }
                        } else {
                            for &sample in data {
                                let _ = producer.try_push(sample as f32 / 32768.0);
                            }
                        }
                    },
                    err_fn,
                    None,
                )
            }
            SampleFormat::I32 => {
                self.device.build_input_stream(
                    &self.config.clone().into(),
                    move |data: &[i32], _: &_| {
                        if !is_running_clone.load(Ordering::Relaxed) { return; }
                        if channels > 1 {
                            for chunk in data.chunks(channels) {
                                let _ = producer.try_push(chunk[0] as f32 / 2147483648.0);
                            }
                        } else {
                            for &sample in data {
                                let _ = producer.try_push(sample as f32 / 2147483648.0);
                            }
                        }
                    },
                    err_fn,
                    None,
                )
            }
            _ => Err(cpal::BuildStreamError::StreamConfigNotSupported),
        };

        let stream = match stream_result {
            Ok(s) => {
                let _ = s.play();
                Some(s)
            }
            Err(e) => {
                eprintln!("[SystemAudio] Failed to build loopback stream: {}", e);
                None
            }
        };

        SpeakerStream {
            _stream: stream,
            consumer: Some(consumer),
            sample_rate,
            is_running,
        }
    }
}

pub struct SpeakerStream {
    _stream: Option<Stream>,
    consumer: Option<HeapCons<f32>>,
    sample_rate: u32,
    is_running: Arc<AtomicBool>,
}

impl SpeakerStream {
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }
    
    pub fn take_consumer(&mut self) -> Option<HeapCons<f32>> {
        self.consumer.take()
    }
}

impl Drop for SpeakerStream {
    fn drop(&mut self) {
        self.is_running.store(false, Ordering::SeqCst);
    }
}