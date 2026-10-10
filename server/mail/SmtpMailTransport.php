<?php
declare(strict_types=1);
namespace BeyndaCalculator\Mail;
use RuntimeException;
final class SmtpMailTransport implements MailTransport {
    public function __construct(private readonly string $host, private readonly int $port, private readonly string $username, private readonly string $password, private readonly string $from) {}
    public function send(MailMessage $m): void {
        foreach ([$this->from, $m->recipient] as $a) if (!filter_var($a,FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/',$a)) throw new RuntimeException('Invalid mail address');
        if ($this->host !== 'smtp.example.invalid' || $this->port !== 465 || !$this->password) throw new RuntimeException('SMTP not configured');
        $ctx=stream_context_create(['ssl'=>['verify_peer'=>true,'verify_peer_name'=>true,'peer_name'=>$this->host]]);
        $s=@stream_socket_client('ssl://'.$this->host.':'.$this->port,$errno,$errstr,20,STREAM_CLIENT_CONNECT,$ctx);
        if (!$s) throw new RuntimeException('SMTP connection failed');
        stream_set_timeout($s,20);
        try {
            $this->expect($s,[220]);
            foreach ([['EHLO example.invalid',[250]],['AUTH LOGIN',[334]],[base64_encode($this->username),[334]],[base64_encode($this->password),[235]],['MAIL FROM:<'.$this->from.'>',[250]],['RCPT TO:<'.$m->recipient.'>',[250,251]],['DATA',[354]]] as [$cmd,$codes]) { $this->write($s,$cmd."\r\n"); $this->expect($s,$codes); }
            $b='quote_'.bin2hex(random_bytes(16)); $f=basename($m->pdfFilename);
            if (preg_match('/[^A-Za-z0-9_.-]/',$f)) throw new RuntimeException('Invalid attachment name');
            $data='Date: '.gmdate('D, d M Y H:i:s')." +0000\r\nFrom: ".$this->from."\r\nTo: ".$m->recipient."\r\nSubject: =?UTF-8?B?".base64_encode($m->subject)."?=\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"$b\"\r\n\r\n--$b\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n".chunk_split(base64_encode($m->text))."--$b\r\nContent-Type: application/pdf; name=\"$f\"\r\nContent-Disposition: attachment; filename=\"$f\"\r\nContent-Transfer-Encoding: base64\r\n\r\n".chunk_split(base64_encode($m->pdfBytes))."--$b--\r\n";
            $this->write($s,$data.".\r\n"); $this->expect($s,[250]);
            // DATA acceptance is delivery success; disconnect errors must not cause duplicate retries.
            @fwrite($s,"QUIT\r\n");
        } finally { fclose($s); }
    }
    private function write($s,string $data): void {
        while ($data !== '') { $n=fwrite($s,$data); if (!$n) throw new RuntimeException('SMTP write failed'); $data=substr($data,$n); }
    }
    private function expect($s,array $codes): void {
        for ($i=0;$i<100;$i++) { $line=fgets($s,4096); if ($line===false || !preg_match('/^(\d{3})([ -])/',$line,$m)) throw new RuntimeException('SMTP response failed'); if ($m[2]===' ') { if (!in_array((int)$m[1],$codes,true)) throw new RuntimeException('SMTP rejected operation: '.$m[1]); return; } }
        throw new RuntimeException('SMTP response too long');
    }
}
